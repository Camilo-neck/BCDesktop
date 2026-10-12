//! Study plans: prerequisites scraped from the SIA and the graph built on them.

use bc_core::academic::passed_codes;
use bc_core::curriculum::{build, Graph, Options};
use bc_core::model::CareerRef;
use bc_core::storage::StoredPlan;
use bc_core::Error;
use chrono::{DateTime, Utc};
use serde::Serialize;
use tauri::{AppHandle, State};

use super::{emit_progress, CmdResult};
use crate::state::AppState;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanSummary {
    pub career_key: String,
    pub career_name: String,
    pub fetched_at: DateTime<Utc>,
}

#[tauri::command(async)]
pub fn plans_list(state: State<'_, AppState>) -> CmdResult<Vec<PlanSummary>> {
    Ok(state
        .db()
        .plans()?
        .into_iter()
        .map(|(career_key, career_name, fetched_at)| PlanSummary {
            career_key,
            career_name,
            fetched_at,
        })
        .collect())
}

/// Scrape the prerequisites of every course of `career` (≈ 30–60 s) and store them.
#[tauri::command]
pub async fn plan_fetch(
    app: AppHandle,
    state: State<'_, AppState>,
    career: CareerRef,
) -> CmdResult<PlanSummary> {
    state.cancel.reset();
    let courses = state
        .sia
        .fetch_all_prereqs(&career, 3, &state.cancel, |p| {
            emit_progress(&app, "plan", p.done, p.total, p.current)
        })
        .await?;
    if courses.is_empty() {
        return Err(Error::NotFound(
            "El SIA no devolvió asignaturas para ese plan.".into(),
        ));
    }
    let name = if career.name.is_empty() {
        career.key()
    } else {
        career.name.clone()
    };
    state.db().save_plan(&career.key(), &name, &courses)?;
    Ok(PlanSummary {
        career_key: career.key(),
        career_name: name,
        fetched_at: Utc::now(),
    })
}

#[tauri::command(async)]
pub fn plan_delete(state: State<'_, AppState>, career_key: String) -> CmdResult<()> {
    state.db().delete_plan(&career_key)
}

#[tauri::command(async)]
pub fn plan_graph(
    state: State<'_, AppState>,
    career_key: String,
    options: Options,
    with_history: bool,
) -> CmdResult<Graph> {
    let db = state.db();
    let plan: StoredPlan = db
        .plan(&career_key)?
        .ok_or_else(|| Error::NotFound("Ese plan no está descargado.".into()))?;
    let passed = if with_history {
        db.latest_history()?
            .map(|h| passed_codes(&h.history))
            .unwrap_or_default()
    } else {
        Vec::new()
    };
    Ok(build(&plan.courses, &passed, &options))
}
