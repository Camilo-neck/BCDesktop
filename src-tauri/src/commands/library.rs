//! The student's course library: courses fetched from the SIA or added by hand,
//! their colors and favourite groups.

use std::collections::BTreeMap;

use bc_core::model::{CareerRef, Course, CourseSource};
use bc_core::scheduler::Selection;
use bc_core::storage::LibraryCourse;
use bc_core::Error;
use chrono::Utc;
use serde::Serialize;
use tauri::{AppHandle, State};

use super::{emit_progress, CmdResult};
use crate::state::AppState;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Library {
    pub courses: Vec<LibraryCourse>,
    pub favorites: Vec<Selection>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FetchFailure {
    pub code: String,
    pub message: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FetchReport {
    pub updated: Vec<String>,
    pub failed: Vec<FetchFailure>,
}

fn library_of(state: &AppState) -> CmdResult<Library> {
    let db = state.db();
    Ok(Library {
        courses: db.library()?,
        favorites: db.favorites()?,
    })
}

#[tauri::command]
pub fn library_list(state: State<'_, AppState>) -> CmdResult<Library> {
    library_of(&state)
}

async fn fetch_into_library(
    app: &AppHandle,
    state: &AppState,
    career: &CareerRef,
    codes: &[String],
) -> CmdResult<FetchReport> {
    state.cancel.reset();
    let results = state
        .sia
        .fetch_courses(career, codes, &state.cancel, |p| {
            emit_progress(app, "courses", p.done, p.total, p.current)
        })
        .await?;
    let mut ok = Vec::new();
    let mut report = FetchReport {
        updated: Vec::new(),
        failed: Vec::new(),
    };
    for (code, r) in results {
        match r {
            Ok(c) => {
                report.updated.push(code);
                ok.push(c);
            }
            Err(e) => report.failed.push(FetchFailure {
                code,
                message: e.to_string(),
            }),
        }
    }
    state.db().upsert_courses(&ok)?;
    Ok(report)
}

/// Open the selected courses in the SIA and add them to the library.
#[tauri::command]
pub async fn library_fetch(
    app: AppHandle,
    state: State<'_, AppState>,
    career: CareerRef,
    codes: Vec<String>,
) -> CmdResult<FetchReport> {
    if codes.is_empty() {
        return Err(Error::Invalid("Selecciona al menos una asignatura.".into()));
    }
    fetch_into_library(&app, &state, &career, &codes).await
}

/// Re-download courses (all of them, or `codes`) grouped by the career they came from.
#[tauri::command]
pub async fn library_refresh(
    app: AppHandle,
    state: State<'_, AppState>,
    codes: Option<Vec<String>>,
) -> CmdResult<FetchReport> {
    let lib = state.db().library()?;
    let mut by_career: BTreeMap<String, (CareerRef, Vec<String>)> = BTreeMap::new();
    for item in lib {
        let c = item.course;
        if c.source != CourseSource::Sia || codes.as_ref().is_some_and(|w| !w.contains(&c.code)) {
            continue;
        }
        if let Some(career) = c.career {
            by_career
                .entry(career.key())
                .or_insert_with(|| (career, Vec::new()))
                .1
                .push(c.code);
        }
    }
    let mut total = FetchReport {
        updated: Vec::new(),
        failed: Vec::new(),
    };
    for (_, (career, codes)) in by_career {
        let r = fetch_into_library(&app, &state, &career, &codes).await?;
        total.updated.extend(r.updated);
        total.failed.extend(r.failed);
    }
    Ok(total)
}

/// Add or replace a course typed by the student.
#[tauri::command]
pub fn library_save_manual(state: State<'_, AppState>, mut course: Course) -> CmdResult<Library> {
    if course.code.trim().is_empty() || course.name.trim().is_empty() {
        return Err(Error::Invalid(
            "La asignatura necesita código y nombre.".into(),
        ));
    }
    course.source = CourseSource::Manual;
    course.fetched_at = Utc::now();
    for g in &mut course.groups {
        g.sessions.retain(|s| s.end > s.start);
        g.sessions.sort_by_key(|s| (s.day, s.start));
    }
    state.db().upsert_courses(&[course])?;
    library_of(&state)
}

#[tauri::command]
pub fn library_remove(state: State<'_, AppState>, code: String) -> CmdResult<Library> {
    state.db().remove_course(&code)?;
    library_of(&state)
}

#[tauri::command]
pub fn library_set_color(state: State<'_, AppState>, code: String, color: String) -> CmdResult<()> {
    let valid = color.len() == 7
        && color.starts_with('#')
        && color[1..].chars().all(|c| c.is_ascii_hexdigit());
    if !valid {
        return Err(Error::Invalid("Color inválido".into()));
    }
    state.db().set_course_color(&code, &color)?;
    Ok(())
}

#[tauri::command]
pub fn favorites_toggle(state: State<'_, AppState>, selection: Selection) -> CmdResult<bool> {
    state.db().toggle_favorite(&selection)
}
