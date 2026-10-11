//! Schedules and the schedule generator.
//!
//! The web backend used `python-constraint`, which enumerates *every* solution
//! into memory and checks collisions by comparing hour strings pairwise inside
//! each constraint call. Here:
//!
//! 1. every candidate group is reduced once to a [`WeekMask`];
//! 2. courses are ordered by how few candidates they have (fail-first);
//! 3. a depth-first search keeps the running union mask, so a collision test is
//!    one bitset intersection, and prunes on credits;
//! 4. only the best `limit` schedules are kept (bounded heap), ranked by gaps,
//!    days on campus, time-of-day preference, favourites and spots;
//! 5. when not every course fits, the search maximises how many do instead of
//!    dropping courses from the end of the list.

mod generator;

pub use generator::{
    generate, GenerateRequest, GenerateResult, GeneratedSchedule, Metrics, Unschedulable,
};

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use crate::model::Day;

/// A group chosen for a course in a schedule.
#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Selection {
    pub course_code: String,
    pub group_id: String,
}

/// A personal time block (work, commute) the student keeps free.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Block {
    pub day: Day,
    pub start: u16,
    pub end: u16,
    #[serde(default)]
    pub label: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Schedule {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub selections: Vec<Selection>,
    #[serde(default)]
    pub blocks: Vec<Block>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl Schedule {
    pub fn new(name: impl Into<String>) -> Schedule {
        let now = Utc::now();
        Schedule {
            id: uuid::Uuid::new_v4().to_string(),
            name: name.into(),
            selections: Vec::new(),
            blocks: Vec::new(),
            created_at: now,
            updated_at: now,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum TimeOfDay {
    #[default]
    Any,
    Morning,
    Afternoon,
    Evening,
}

#[derive(Clone, Debug, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Constraints {
    /// Days classes may fall on; empty = any day.
    pub days: Vec<Day>,
    /// Classes must start at or after `from` and end at or before `to` (minutes).
    pub window: Option<(u16, u16)>,
    pub max_credits: Option<u32>,
    pub only_with_spots: bool,
    /// Personal blocks that must stay free.
    pub blocks: Vec<Block>,
    /// Groups that must be part of every result.
    pub locked: Vec<Selection>,
    /// Groups never to use.
    pub excluded: Vec<Selection>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Preferences {
    /// Weight of idle hours between classes.
    pub gaps: f64,
    /// Weight of each day with classes.
    pub days: f64,
    pub time_of_day: TimeOfDay,
    /// Groups the student marked with a heart.
    pub favorites: Vec<Selection>,
    /// Weight of choosing groups with few remaining spots.
    pub spots: f64,
}

impl Default for Preferences {
    fn default() -> Self {
        Preferences {
            gaps: 1.0,
            days: 1.0,
            time_of_day: TimeOfDay::Any,
            favorites: Vec::new(),
            spots: 0.3,
        }
    }
}
