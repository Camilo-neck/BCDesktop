//! Schedules (named sets of selected groups) and the generator.

use bc_core::scheduler::{generate, GenerateRequest, GenerateResult, Schedule};
use bc_core::Error;
use chrono::Utc;
use tauri::State;

use super::CmdResult;
use crate::state::AppState;

#[tauri::command(async)]
pub fn schedules_list(state: State<'_, AppState>) -> CmdResult<Vec<Schedule>> {
    let db = state.db();
    let mut list = db.schedules()?;
    if list.is_empty() {
        let first = Schedule::new("Mi horario");
        db.save_schedule(&first)?;
        list.push(first);
    }
    Ok(list)
}

#[tauri::command(async)]
pub fn schedule_create(state: State<'_, AppState>, name: String) -> CmdResult<Schedule> {
    let name = name.trim();
    let s = Schedule::new(if name.is_empty() {
        "Nuevo horario"
    } else {
        name
    });
    state.db().save_schedule(&s)?;
    Ok(s)
}

#[tauri::command(async)]
pub fn schedule_save(state: State<'_, AppState>, mut schedule: Schedule) -> CmdResult<Schedule> {
    if schedule.name.trim().is_empty() {
        return Err(Error::Invalid("El horario necesita un nombre.".into()));
    }
    schedule.updated_at = Utc::now();
    state.db().save_schedule(&schedule)?;
    Ok(schedule)
}

#[tauri::command(async)]
pub fn schedule_duplicate(state: State<'_, AppState>, id: String) -> CmdResult<Schedule> {
    let db = state.db();
    let src = db
        .schedules()?
        .into_iter()
        .find(|s| s.id == id)
        .ok_or_else(|| Error::NotFound("Horario no encontrado".into()))?;
    let mut copy = Schedule::new(format!("{} (copia)", src.name));
    copy.selections = src.selections;
    copy.blocks = src.blocks;
    db.save_schedule(&copy)?;
    Ok(copy)
}

#[tauri::command(async)]
pub fn schedule_delete(state: State<'_, AppState>, id: String) -> CmdResult<()> {
    state.db().delete_schedule(&id)?;
    Ok(())
}

#[tauri::command(async)]
pub fn schedules_reorder(state: State<'_, AppState>, ids: Vec<String>) -> CmdResult<()> {
    state.db().reorder_schedules(&ids)?;
    Ok(())
}

/// Runs on a blocking thread: the search is CPU-bound.
#[tauri::command]
pub async fn schedules_generate(request: GenerateRequest) -> CmdResult<GenerateResult> {
    tokio::task::spawn_blocking(move || generate(&request))
        .await
        .map_err(|e| Error::External(format!("El generador falló: {e}")))
}
