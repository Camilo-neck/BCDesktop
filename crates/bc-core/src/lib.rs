//! BetterCampus core.
//!
//! Everything the desktop app computes lives here, independent of Tauri so it can be
//! tested with `cargo test` and reused from a CLI or a server:
//!
//! * [`sia`] — client and parsers for the public SIA course catalog (Oracle ADF).
//! * [`scheduler`] — conflict detection and schedule generation over bitmask weeks.
//! * [`academic`] — parser and calculators for the SIA academic history text.
//! * [`curriculum`] — prerequisite graph of a study plan.
//! * [`integrations`] — LosEstudiantes, BetterCampus stats API, iCalendar and Google Calendar.
//! * [`storage`] — local SQLite persistence.

pub mod academic;
pub mod curriculum;
pub mod error;
pub mod integrations;
pub mod model;
pub mod scheduler;
pub mod sia;
pub mod storage;
pub mod text;
pub mod week;

pub use error::{Error, Result};
