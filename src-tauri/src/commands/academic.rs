//! Academic history parsing and GPA calculators. Nothing leaves the computer.

use bc_core::academic::{self, Projection};
use bc_core::storage::StoredHistory;
use bc_core::Error;
use tauri::State;

use super::CmdResult;
use crate::state::AppState;

#[tauri::command(async)]
pub fn history_parse(state: State<'_, AppState>, text: String) -> CmdResult<StoredHistory> {
    let parsed = academic::parse(&text)?;
    state.db().save_history(&text, &parsed)
}

#[tauri::command(async)]
pub fn history_latest(state: State<'_, AppState>) -> CmdResult<Option<StoredHistory>> {
    state.db().latest_history()
}

#[tauri::command(async)]
pub fn history_clear(state: State<'_, AppState>) -> CmdResult<()> {
    state.db().delete_histories()
}

fn latest(state: &AppState) -> CmdResult<academic::AcademicHistory> {
    state
        .db()
        .latest_history()?
        .map(|h| h.history)
        .ok_or_else(|| Error::NotFound("Primero carga tu historia académica.".into()))
}

#[tauri::command(async)]
pub fn calc_papa_after(
    state: State<'_, AppState>,
    papi: f64,
    credits: u32,
) -> CmdResult<Projection> {
    academic::papa_after(&latest(&state)?, papi, credits)
}

#[tauri::command(async)]
pub fn calc_papi_for(
    state: State<'_, AppState>,
    target: f64,
    credits: u32,
) -> CmdResult<Projection> {
    academic::papi_for(&latest(&state)?, target, credits)
}

#[tauri::command(async)]
pub fn calc_max_papa(state: State<'_, AppState>) -> CmdResult<Projection> {
    academic::max_papa(&latest(&state)?)
}
