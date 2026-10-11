//! LosEstudiantes, spot statistics, iCalendar and Google Calendar.

use std::collections::HashMap;
use std::path::PathBuf;

use bc_core::integrations::google::{self, Account, ExportResult};
use bc_core::integrations::losestudiantes::{self, Professor};
use bc_core::integrations::{events_for, ics, stats, Term};
use bc_core::scheduler::Schedule;
use bc_core::Error;
use chrono::Duration;
use serde_json::Value;
use tauri::{AppHandle, State};
use tauri_plugin_opener::OpenerExt;

use super::{emit_progress, CmdResult};
use crate::state::AppState;

#[tauri::command]
pub async fn professor_lookup(
    state: State<'_, AppState>,
    name: String,
) -> CmdResult<Option<Professor>> {
    let key = format!("le:{}", bc_core::text::normalize(&name));
    if let Some(hit) = state.db().cache_get::<Option<Professor>>(&key)? {
        return Ok(hit);
    }
    let found = losestudiantes::find(&state.http, &name).await?;
    state.db().cache_put(&key, &found, Duration::days(7))?;
    Ok(found)
}

#[tauri::command]
pub async fn stats_inscriptions(
    state: State<'_, AppState>,
    career_name: String,
    course_code: String,
) -> CmdResult<Value> {
    let key = format!("stats:{career_name}:{course_code}");
    if let Some(hit) = state.db().cache_get::<Value>(&key)? {
        return Ok(hit);
    }
    let base = state.stats_api();
    let v = stats::inscription_stats(&state.http, &base, &career_name, &course_code).await?;
    state.db().cache_put(&key, &v, Duration::hours(12))?;
    Ok(v)
}

fn schedule_events(
    state: &AppState,
    schedule_id: &str,
    term: Term,
) -> CmdResult<(Schedule, Vec<bc_core::integrations::CalendarEvent>)> {
    let db = state.db();
    let schedule = db
        .schedules()?
        .into_iter()
        .find(|s| s.id == schedule_id)
        .ok_or_else(|| Error::NotFound("Horario no encontrado".into()))?;
    let library = db.library()?;
    let colors: HashMap<String, String> = library
        .iter()
        .map(|l| (l.course.code.clone(), l.color.clone()))
        .collect();
    let courses: Vec<_> = library.into_iter().map(|l| l.course).collect();
    let events = events_for(&schedule, &courses, term, &|code| colors.get(code).cloned());
    if events.is_empty() {
        return Err(Error::Invalid(
            "El horario no tiene clases para exportar.".into(),
        ));
    }
    Ok((schedule, events))
}

#[tauri::command]
pub fn export_ics(
    state: State<'_, AppState>,
    schedule_id: String,
    term: Term,
    path: PathBuf,
) -> CmdResult<String> {
    let (schedule, events) = schedule_events(&state, &schedule_id, term)?;
    std::fs::write(&path, ics::to_ics(&schedule.name, &events))?;
    Ok(path.display().to_string())
}

#[tauri::command]
pub fn google_status(state: State<'_, AppState>) -> Option<Account> {
    state.google_account()
}

#[tauri::command]
pub async fn google_connect(app: AppHandle, state: State<'_, AppState>) -> CmdResult<Account> {
    let cfg = state.google_client();
    let (tokens, account) = google::authorize(&state.http, &cfg, |url| {
        app.opener()
            .open_url(url, None::<&str>)
            .map_err(|e| Error::External(format!("No se pudo abrir el navegador: {e}")))
    })
    .await?;
    state.google_save(tokens, &account).await?;
    Ok(account)
}

#[tauri::command]
pub async fn google_disconnect(state: State<'_, AppState>) -> CmdResult<()> {
    state.google_forget().await
}

#[tauri::command]
pub async fn google_export(
    app: AppHandle,
    state: State<'_, AppState>,
    schedule_id: String,
    term: Term,
) -> CmdResult<ExportResult> {
    let (schedule, events) = schedule_events(&state, &schedule_id, term)?;
    let token = state.google_access_token().await?;
    let mut calendars: HashMap<String, String> =
        state.db().setting("googleCalendars")?.unwrap_or_default();
    let previous = calendars.get(&schedule.id).cloned();
    let name = format!("BetterCampus · {}", schedule.name);
    let result = google::export(
        &state.http,
        &token,
        &name,
        previous.as_deref(),
        &events,
        |done, total| emit_progress(&app, "google", done, total, String::new()),
    )
    .await?;
    calendars.insert(schedule.id.clone(), result.calendar_id.clone());
    state
        .db()
        .set_setting("googleCalendars", &serde_json::to_value(&calendars)?)?;
    Ok(result)
}
