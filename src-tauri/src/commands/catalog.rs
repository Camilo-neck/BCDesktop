//! SIA catalog: cascading dropdowns and the course table of a career.

use bc_core::model::{CareerRef, CourseSummary};
use bc_core::sia::DropdownOption;
use chrono::Duration;
use serde::Serialize;
use tauri::State;

use super::CmdResult;
use crate::state::AppState;

const DROPDOWN_TTL_DAYS: i64 = 7;
const COURSES_TTL_HOURS: i64 = 6;

async fn cached<T, F>(
    state: &AppState,
    key: String,
    ttl: Duration,
    force: bool,
    fetch: F,
) -> CmdResult<T>
where
    T: Serialize + serde::de::DeserializeOwned,
    F: std::future::Future<Output = CmdResult<T>>,
{
    if !force {
        if let Some(v) = state.db().cache_get::<T>(&key)? {
            return Ok(v);
        }
    }
    let value = fetch.await?;
    state.db().cache_put(&key, &value, ttl)?;
    Ok(value)
}

#[tauri::command]
pub async fn catalog_levels(
    state: State<'_, AppState>,
    force: Option<bool>,
) -> CmdResult<Vec<DropdownOption>> {
    let s = state.inner();
    cached(
        s,
        "catalog:levels".into(),
        Duration::days(DROPDOWN_TTL_DAYS),
        force.unwrap_or(false),
        s.sia.levels(),
    )
    .await
}

#[tauri::command]
pub async fn catalog_campuses(
    state: State<'_, AppState>,
    level: String,
    force: Option<bool>,
) -> CmdResult<Vec<DropdownOption>> {
    let s = state.inner();
    cached(
        s,
        format!("catalog:campuses:{level}"),
        Duration::days(DROPDOWN_TTL_DAYS),
        force.unwrap_or(false),
        s.sia.campuses(&level),
    )
    .await
}

#[tauri::command]
pub async fn catalog_faculties(
    state: State<'_, AppState>,
    level: String,
    campus: String,
    force: Option<bool>,
) -> CmdResult<Vec<DropdownOption>> {
    let s = state.inner();
    let key = format!("catalog:faculties:{level}:{campus}");
    cached(
        s,
        key,
        Duration::days(DROPDOWN_TTL_DAYS),
        force.unwrap_or(false),
        s.sia.faculties(&level, &campus),
    )
    .await
}

#[tauri::command]
pub async fn catalog_plans(
    state: State<'_, AppState>,
    level: String,
    campus: String,
    faculty: String,
    force: Option<bool>,
) -> CmdResult<Vec<DropdownOption>> {
    let s = state.inner();
    let key = format!("catalog:plans:{level}:{campus}:{faculty}");
    cached(
        s,
        key,
        Duration::days(DROPDOWN_TTL_DAYS),
        force.unwrap_or(false),
        s.sia.plans(&level, &campus, &faculty),
    )
    .await
}

#[derive(Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CareerCourses {
    pub career: CareerRef,
    pub courses: Vec<CourseSummary>,
}

#[tauri::command]
pub async fn catalog_courses(
    state: State<'_, AppState>,
    career: CareerRef,
    force: Option<bool>,
) -> CmdResult<CareerCourses> {
    let s = state.inner();
    let key = format!("catalog:courses:{}", career.key());
    let fetch = async {
        let listing = s.sia.list_courses(&career).await?;
        Ok(CareerCourses {
            career: listing.career,
            courses: listing.courses,
        })
    };
    cached(
        s,
        key,
        Duration::hours(COURSES_TTL_HOURS),
        force.unwrap_or(false),
        fetch,
    )
    .await
}

#[tauri::command]
pub fn sia_cancel(state: State<'_, AppState>) {
    state.cancel.cancel();
}
