//! Settings, app info and maintenance.

use serde::Serialize;
use serde_json::{Map, Value};
use tauri::State;

use super::CmdResult;
use crate::state::{AppState, DEFAULT_STATS_API};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    pub version: &'static str,
    pub data_dir: String,
    pub os: &'static str,
    pub arch: &'static str,
    pub default_stats_api: &'static str,
    pub google_configured: bool,
}

#[tauri::command(async)]
pub fn app_info(state: State<'_, AppState>) -> AppInfo {
    AppInfo {
        version: env!("CARGO_PKG_VERSION"),
        data_dir: state.data_dir.display().to_string(),
        os: std::env::consts::OS,
        arch: std::env::consts::ARCH,
        default_stats_api: DEFAULT_STATS_API,
        google_configured: !state.google_client().client_id.is_empty(),
    }
}

/// Keys the UI may read and write. Tokens and internal bookkeeping stay private.
const PUBLIC_KEYS: &[&str] = &[
    "theme",
    "defaultCareer",
    "statsApiUrl",
    "googleClientId",
    "googleClientSecret",
    "tours",
    "weekStart",
    "gridHours",
    "showWeekend",
    "term",
    "onboarded",
    "activeScheduleId",
];

#[tauri::command(async)]
pub fn settings_get(state: State<'_, AppState>) -> CmdResult<Map<String, Value>> {
    let mut all = state.db().settings()?;
    all.retain(|k, _| PUBLIC_KEYS.contains(&k.as_str()));
    Ok(all)
}

#[tauri::command(async)]
pub fn settings_set(state: State<'_, AppState>, key: String, value: Value) -> CmdResult<()> {
    if !PUBLIC_KEYS.contains(&key.as_str()) {
        return Err(bc_core::Error::Invalid(format!(
            "Ajuste desconocido: {key}"
        )));
    }
    state.db().set_setting(&key, &value)
}

#[tauri::command(async)]
pub fn cache_clear(state: State<'_, AppState>) -> CmdResult<usize> {
    state.db().cache_clear()
}

#[tauri::command]
pub async fn data_reset(state: State<'_, AppState>, include_settings: bool) -> CmdResult<()> {
    state.db().reset(include_settings)?;
    if include_settings {
        state.google_forget().await?;
    }
    Ok(())
}
