//! Google Calendar export with OAuth 2.0 for installed apps.
//!
//! Flow (RFC 8252): open the system browser on Google's consent page with a PKCE
//! challenge and a loopback redirect (`http://127.0.0.1:<random port>`), wait for
//! the redirect on a one-shot local listener, exchange the code for tokens. No
//! BetterCampus server is involved and the client secret of a "Desktop app"
//! OAuth client is not confidential by Google's own definition.

use std::time::Duration;

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use chrono::{DateTime, Utc};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

use super::ics::TIMEZONE;
use super::CalendarEvent;
use crate::error::{Error, Result};
use crate::text::format_hhmm;

const AUTH_URL: &str = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL: &str = "https://oauth2.googleapis.com/token";
const USERINFO_URL: &str = "https://openidconnect.googleapis.com/v1/userinfo";
const CALENDAR_API: &str = "https://www.googleapis.com/calendar/v3";
/// Least privilege: the app only manages calendars it creates itself.
const SCOPES: &str = "openid email profile https://www.googleapis.com/auth/calendar.app.created";

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientConfig {
    pub client_id: String,
    #[serde(default)]
    pub client_secret: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Tokens {
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub expires_at: DateTime<Utc>,
}

impl Tokens {
    pub fn is_expired(&self) -> bool {
        Utc::now() + chrono::Duration::seconds(60) >= self.expires_at
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Account {
    pub email: String,
    pub name: Option<String>,
    pub picture: Option<String>,
}

#[derive(Debug, Deserialize)]
struct TokenResponse {
    access_token: String,
    expires_in: i64,
    refresh_token: Option<String>,
}

fn random_token(bytes: usize) -> String {
    let mut buf = vec![0u8; bytes];
    rand::thread_rng().fill_bytes(&mut buf);
    URL_SAFE_NO_PAD.encode(buf)
}

fn pkce_pair() -> (String, String) {
    let verifier = random_token(48);
    let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
    (verifier, challenge)
}

const DONE_PAGE: &str = "<!doctype html><meta charset=utf-8><title>BetterCampus</title><body style=\"font-family:system-ui;background:#111411;color:#c5c7c2;display:grid;place-items:center;height:100vh;margin:0\"><div style=\"text-align:center\"><h1 style=\"color:#5bdf7e\">Listo</h1><p>Ya puedes volver a BetterCampus.</p></div>";

/// Wait for Google's redirect on the loopback listener and return its query.
async fn wait_for_redirect(listener: TcpListener, timeout: Duration) -> Result<url::Url> {
    let accept = async {
        loop {
            let (mut stream, _) = listener.accept().await?;
            let mut buf = vec![0u8; 8192];
            let n = stream.read(&mut buf).await?;
            let req = String::from_utf8_lossy(&buf[..n]).to_string();
            let path = req
                .lines()
                .next()
                .and_then(|l| l.split_whitespace().nth(1))
                .unwrap_or("/")
                .to_owned();
            let url = url::Url::parse(&format!("http://127.0.0.1{path}"))
                .map_err(|e| Error::Auth(e.to_string()))?;
            if url.query_pairs().any(|(k, _)| k == "code" || k == "error") {
                let resp = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{DONE_PAGE}",
                    DONE_PAGE.len()
                );
                stream.write_all(resp.as_bytes()).await?;
                return Ok::<_, Error>(url);
            }
            // Favicon or a stray request: answer and keep waiting.
            stream
                .write_all(b"HTTP/1.1 204 No Content\r\nConnection: close\r\n\r\n")
                .await?;
        }
    };
    tokio::time::timeout(timeout, accept)
        .await
        .map_err(|_| Error::Auth("No se completó el inicio de sesión a tiempo.".into()))?
}

/// Run the whole consent flow. `open_browser` receives the URL to show.
pub async fn authorize(
    http: &reqwest::Client,
    cfg: &ClientConfig,
    open_browser: impl FnOnce(&str) -> Result<()>,
) -> Result<(Tokens, Account)> {
    if cfg.client_id.trim().is_empty() {
        return Err(Error::Auth(
            "Google Calendar no está disponible en esta versión de la app.".into(),
        ));
    }
    let listener = TcpListener::bind("127.0.0.1:0").await?;
    let redirect = format!("http://127.0.0.1:{}", listener.local_addr()?.port());
    let (verifier, challenge) = pkce_pair();
    let state = random_token(16);

    let mut auth = url::Url::parse(AUTH_URL).expect("static url");
    auth.query_pairs_mut()
        .append_pair("client_id", &cfg.client_id)
        .append_pair("redirect_uri", &redirect)
        .append_pair("response_type", "code")
        .append_pair("scope", SCOPES)
        .append_pair("code_challenge", &challenge)
        .append_pair("code_challenge_method", "S256")
        .append_pair("state", &state)
        .append_pair("access_type", "offline")
        .append_pair("prompt", "consent");
    open_browser(auth.as_str())?;

    let back = wait_for_redirect(listener, Duration::from_secs(300)).await?;
    let get = |k: &str| {
        back.query_pairs()
            .find(|(q, _)| q == k)
            .map(|(_, v)| v.into_owned())
    };
    if let Some(err) = get("error") {
        return Err(Error::Auth(if err == "access_denied" {
            "Cancelaste el inicio de sesión.".into()
        } else {
            err
        }));
    }
    if get("state").as_deref() != Some(state.as_str()) {
        return Err(Error::Auth(
            "La respuesta de Google no corresponde a esta solicitud.".into(),
        ));
    }
    let code = get("code").ok_or_else(|| Error::Auth("Google no devolvió un código.".into()))?;

    let mut form = vec![
        ("code", code),
        ("client_id", cfg.client_id.clone()),
        ("redirect_uri", redirect),
        ("grant_type", "authorization_code".into()),
        ("code_verifier", verifier),
    ];
    if let Some(s) = cfg.client_secret.as_ref().filter(|s| !s.is_empty()) {
        form.push(("client_secret", s.clone()));
    }
    let tokens = token_request(http, &form).await?;
    let account = account(http, &tokens.access_token).await?;
    Ok((tokens, account))
}

async fn token_request(http: &reqwest::Client, form: &[(&str, String)]) -> Result<Tokens> {
    let res = http.post(TOKEN_URL).form(form).send().await?;
    if !res.status().is_success() {
        let body = res.text().await.unwrap_or_default();
        return Err(Error::Auth(format!(
            "Google rechazó la autorización: {body}"
        )));
    }
    let t: TokenResponse = res.json().await?;
    Ok(Tokens {
        access_token: t.access_token,
        refresh_token: t.refresh_token,
        expires_at: Utc::now() + chrono::Duration::seconds(t.expires_in),
    })
}

pub async fn refresh(
    http: &reqwest::Client,
    cfg: &ClientConfig,
    refresh_token: &str,
) -> Result<Tokens> {
    let mut form = vec![
        ("client_id", cfg.client_id.clone()),
        ("refresh_token", refresh_token.to_owned()),
        ("grant_type", "refresh_token".into()),
    ];
    if let Some(s) = cfg.client_secret.as_ref().filter(|s| !s.is_empty()) {
        form.push(("client_secret", s.clone()));
    }
    let mut t = token_request(http, &form).await?;
    t.refresh_token
        .get_or_insert_with(|| refresh_token.to_owned());
    Ok(t)
}

pub async fn account(http: &reqwest::Client, access_token: &str) -> Result<Account> {
    let v: Value = http
        .get(USERINFO_URL)
        .bearer_auth(access_token)
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;
    Ok(Account {
        email: v
            .get("email")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_owned(),
        name: v.get("name").and_then(Value::as_str).map(str::to_owned),
        picture: v.get("picture").and_then(Value::as_str).map(str::to_owned),
    })
}

/// Google Calendar color ids closest to a hex color.
fn color_id(hex: &str) -> Option<&'static str> {
    const PALETTE: [(&str, (u8, u8, u8)); 11] = [
        ("1", (0x79, 0x86, 0xcb)),
        ("2", (0x33, 0xb6, 0x79)),
        ("3", (0x8e, 0x24, 0xaa)),
        ("4", (0xe6, 0x7c, 0x73)),
        ("5", (0xf6, 0xbf, 0x26)),
        ("6", (0xf4, 0x51, 0x1e)),
        ("7", (0x03, 0x9b, 0xe5)),
        ("8", (0x61, 0x61, 0x61)),
        ("9", (0x3f, 0x51, 0xb5)),
        ("10", (0x0b, 0x80, 0x43)),
        ("11", (0xd5, 0x00, 0x00)),
    ];
    let h = hex.trim_start_matches('#');
    if h.len() != 6 {
        return None;
    }
    let p = |i: usize| u8::from_str_radix(&h[i..i + 2], 16).ok();
    let (r, g, b) = (p(0)?, p(2)?, p(4)?);
    PALETTE
        .iter()
        .min_by_key(|(_, (pr, pg, pb))| {
            let d = |a: u8, b: u8| (a as i32 - b as i32).pow(2);
            d(r, *pr) + d(g, *pg) + d(b, *pb)
        })
        .map(|(id, _)| *id)
}

/// Whether a failed Calendar API call may succeed if repeated. Google answers 403 both for
/// usage limits (transient) and for missing permissions (permanent); only the body tells them apart.
fn should_retry(status: u16, body: &str) -> bool {
    match status {
        429 | 500..=599 => true,
        403 => body.to_ascii_lowercase().contains("ratelimitexceeded"),
        _ => false,
    }
}

async fn send_with_retry(req: impl Fn() -> reqwest::RequestBuilder) -> Result<Value> {
    let mut wait = Duration::from_millis(500);
    for attempt in 0..5 {
        let res = req().send().await?;
        let status = res.status();
        if status.is_success() {
            return Ok(if status == reqwest::StatusCode::NO_CONTENT {
                Value::Null
            } else {
                res.json().await?
            });
        }
        let body = res.text().await.unwrap_or_default();
        if should_retry(status.as_u16(), &body) && attempt < 4 {
            tokio::time::sleep(wait).await;
            wait *= 2;
            continue;
        }
        return Err(Error::External(format!(
            "Google Calendar respondió {status}: {body}"
        )));
    }
    unreachable!()
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportResult {
    pub calendar_id: String,
    pub created: usize,
    pub failed: usize,
}

/// Create (or replace) a calendar named `name` and add one recurring event per class.
pub async fn export(
    http: &reqwest::Client,
    access_token: &str,
    name: &str,
    previous_calendar: Option<&str>,
    events: &[CalendarEvent],
    on_progress: impl Fn(usize, usize),
) -> Result<ExportResult> {
    if let Some(id) = previous_calendar {
        // Calendars created by the app can be deleted by it; ignore if already gone.
        let _ = http
            .delete(format!("{CALENDAR_API}/calendars/{id}"))
            .bearer_auth(access_token)
            .send()
            .await;
    }
    let cal = send_with_retry(|| {
        http.post(format!("{CALENDAR_API}/calendars"))
            .bearer_auth(access_token)
            .json(&json!({ "summary": name, "timeZone": TIMEZONE, "description": "Horario creado con BetterCampus" }))
    })
    .await?;
    let calendar_id = cal
        .get("id")
        .and_then(Value::as_str)
        .ok_or_else(|| Error::External("Google no devolvió el calendario".into()))?
        .to_owned();

    let (mut created, mut failed) = (0, 0);
    for (i, e) in events.iter().enumerate() {
        on_progress(i, events.len());
        let first = e.first_date();
        let at = |m: u16| format!("{}T{}:00", first.format("%Y-%m-%d"), format_hhmm(m));
        let mut body = json!({
            "summary": e.summary,
            "location": e.location,
            "description": e.description,
            "start": { "dateTime": at(e.start), "timeZone": TIMEZONE },
            "end": { "dateTime": at(e.end), "timeZone": TIMEZONE },
            "recurrence": [format!("RRULE:FREQ=WEEKLY;UNTIL={}", (e.until + chrono::Duration::days(1)).format("%Y%m%dT045959Z"))],
            "reminders": { "useDefault": false, "overrides": [{ "method": "popup", "minutes": 10 }] }
        });
        if let Some(c) = e.color.as_deref().and_then(color_id) {
            body["colorId"] = json!(c);
        }
        let url = format!(
            "{CALENDAR_API}/calendars/{}/events",
            urlencode(&calendar_id)
        );
        match send_with_retry(|| http.post(&url).bearer_auth(access_token).json(&body)).await {
            Ok(_) => created += 1,
            Err(err) => {
                log::warn!("event {} failed: {err}", e.summary);
                failed += 1;
            }
        }
    }
    on_progress(events.len(), events.len());
    Ok(ExportResult {
        calendar_id,
        created,
        failed,
    })
}

fn urlencode(s: &str) -> String {
    url::form_urlencoded::byte_serialize(s.as_bytes()).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pkce_challenge_is_sha256_of_verifier() {
        let (v, c) = pkce_pair();
        assert!(v.len() >= 43);
        assert_eq!(c, URL_SAFE_NO_PAD.encode(Sha256::digest(v.as_bytes())));
    }

    #[test]
    fn retries_only_transient_failures() {
        let quota = r#"{"error":{"code":403,"errors":[{"domain":"usageLimits","reason":"rateLimitExceeded"}]}}"#;
        let user_quota = r#"{"error":{"errors":[{"reason":"userRateLimitExceeded"}]}}"#;
        let forbidden =
            r#"{"error":{"code":403,"errors":[{"domain":"global","reason":"forbidden"}]}}"#;
        assert!(should_retry(429, ""));
        assert!(should_retry(500, ""));
        assert!(should_retry(503, ""));
        assert!(should_retry(403, quota));
        assert!(should_retry(403, user_quota));
        assert!(!should_retry(403, forbidden));
        assert!(!should_retry(401, ""));
        assert!(!should_retry(404, ""));
    }

    #[test]
    fn maps_colors() {
        assert_eq!(color_id("#d50000"), Some("11"));
        assert_eq!(color_id("#388e3c"), Some("10"));
        assert_eq!(color_id("bad"), None);
    }
}
