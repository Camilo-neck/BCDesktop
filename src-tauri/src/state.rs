use std::path::PathBuf;
use std::sync::{Mutex, MutexGuard};
use std::time::Duration;

use bc_core::integrations::google::{self, Account, ClientConfig, Refresh, Tokens};
use bc_core::sia::{Cancel, SiaService};
use bc_core::storage::Db;
use bc_core::{Error, Result};

const KEYRING_SERVICE: &str = "co.com.bettercampus.desktop";
const KEYRING_USER: &str = "google-refresh-token";

/// Stats API base URL, set at build time (see docs/RELEASING.md).
pub const STATS_API: &str = match option_env!("BC_STATS_API_URL") {
    Some(u) => u,
    None => "",
};

pub struct AppState {
    db: Mutex<Db>,
    pub sia: SiaService,
    pub http: reqwest::Client,
    pub cancel: Cancel,
    pub data_dir: PathBuf,
    google: tokio::sync::Mutex<Option<Tokens>>,
}

impl AppState {
    pub fn new(data_dir: PathBuf) -> Result<AppState> {
        let db = Db::open(&data_dir.join("bettercampus.db"))?;
        db.cache_purge_expired()?;
        let http = reqwest::Client::builder()
            .user_agent(concat!("BetterCampus-Desktop/", env!("CARGO_PKG_VERSION")))
            .timeout(Duration::from_secs(30))
            .gzip(true)
            .build()
            .map_err(Error::from)?;
        Ok(AppState {
            db: Mutex::new(db),
            sia: SiaService::new(Duration::from_secs(25)),
            http,
            cancel: Cancel::default(),
            data_dir,
            google: tokio::sync::Mutex::new(None),
        })
    }

    pub fn db(&self) -> MutexGuard<'_, Db> {
        // A poisoned lock only means a previous command panicked mid-write; SQLite
        // transactions already rolled back, so the connection is still usable.
        self.db.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Google OAuth client, set at build time (see docs/RELEASING.md).
    pub fn google_client(&self) -> ClientConfig {
        ClientConfig {
            client_id: option_env!("BC_GOOGLE_CLIENT_ID")
                .unwrap_or_default()
                .to_owned(),
            client_secret: option_env!("BC_GOOGLE_CLIENT_SECRET").map(str::to_owned),
        }
    }

    // ------------------------------------------------------------ google

    fn keyring() -> Option<keyring::Entry> {
        keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER).ok()
    }

    /// Refresh token from the OS keychain, or from the database when the
    /// platform has no keychain service (some minimal Linux desktops).
    fn stored_refresh_token(&self) -> Option<String> {
        Self::keyring()
            .and_then(|e| e.get_password().ok())
            .or_else(|| {
                self.db()
                    .setting::<String>("googleRefreshTokenFallback")
                    .ok()
                    .flatten()
            })
    }

    fn store_refresh_token(&self, token: Option<&str>) {
        let entry = Self::keyring();
        match token {
            Some(t) => {
                let saved = entry.map(|e| e.set_password(t).is_ok()).unwrap_or(false);
                let fallback = if saved {
                    serde_json::Value::Null
                } else {
                    serde_json::json!(t)
                };
                let _ = self
                    .db()
                    .set_setting("googleRefreshTokenFallback", &fallback);
            }
            None => {
                if let Some(e) = entry {
                    let _ = e.delete_credential();
                }
                let _ = self
                    .db()
                    .set_setting("googleRefreshTokenFallback", &serde_json::Value::Null);
            }
        }
    }

    pub async fn google_save(&self, tokens: Tokens, account: &Account) -> Result<()> {
        self.store_refresh_token(tokens.refresh_token.as_deref());
        self.db()
            .set_setting("googleAccount", &serde_json::to_value(account)?)?;
        *self.google.lock().await = Some(tokens);
        Ok(())
    }

    pub async fn google_forget(&self) -> Result<()> {
        self.store_refresh_token(None);
        self.db()
            .set_setting("googleAccount", &serde_json::Value::Null)?;
        *self.google.lock().await = None;
        Ok(())
    }

    pub fn google_account(&self) -> Option<Account> {
        self.db().setting("googleAccount").ok().flatten()
    }

    /// A valid access token, refreshing it when needed.
    pub async fn google_access_token(&self) -> Result<String> {
        let mut guard = self.google.lock().await;
        if let Some(t) = guard.as_ref().filter(|t| !t.is_expired()) {
            return Ok(t.access_token.clone());
        }
        let refresh = guard
            .as_ref()
            .and_then(|t| t.refresh_token.clone())
            .or_else(|| self.stored_refresh_token())
            .ok_or_else(|| Error::Auth("Conecta tu cuenta de Google primero.".into()))?;
        match google::refresh(&self.http, &self.google_client(), &refresh).await? {
            Refresh::Tokens(tokens) => {
                let access = tokens.access_token.clone();
                *guard = Some(tokens);
                Ok(access)
            }
            Refresh::Revoked => {
                // Release the lock first: forgetting the account takes it again.
                drop(guard);
                self.google_forget().await?;
                Err(Error::Auth(google::SESSION_EXPIRED.into()))
            }
        }
    }
}
