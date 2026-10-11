//! Tauri commands: thin adapters between the UI and `bc-core`.
//! Each module groups the commands of one feature.

pub mod academic;
pub mod catalog;
pub mod curriculum;
pub mod integrations;
pub mod library;
pub mod schedules;
pub mod system;

use serde::Serialize;
use tauri::{AppHandle, Emitter};

pub type CmdResult<T> = Result<T, bc_core::Error>;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProgressEvent<'a> {
    pub task: &'a str,
    pub done: usize,
    pub total: usize,
    pub current: String,
}

pub const PROGRESS_EVENT: &str = "bc://progress";

pub fn emit_progress(app: &AppHandle, task: &str, done: usize, total: usize, current: String) {
    let _ = app.emit(
        PROGRESS_EVENT,
        ProgressEvent {
            task,
            done,
            total,
            current,
        },
    );
}
