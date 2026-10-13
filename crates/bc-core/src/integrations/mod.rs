//! External services and export formats.

pub mod google;
pub mod ics;
pub mod losestudiantes;
pub mod stats;

use chrono::{Datelike, NaiveDate};
use serde::{Deserialize, Serialize};

use crate::error::{Error, Result};
use crate::model::{Course, Day};
use crate::scheduler::Schedule;

/// One weekly-repeating class, ready for any calendar.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CalendarEvent {
    pub summary: String,
    pub location: String,
    pub description: String,
    pub day: Day,
    pub start: u16,
    pub end: u16,
    /// First date the class may happen (inclusive).
    pub from: NaiveDate,
    /// Last date the class may happen (inclusive).
    pub until: NaiveDate,
    pub color: Option<String>,
}

impl CalendarEvent {
    /// First date on or after `from` that falls on `day`.
    pub fn first_date(&self) -> NaiveDate {
        let target = self.day.index() as i64;
        let current = self.from.weekday().num_days_from_monday() as i64;
        self.from + chrono::Duration::days((target - current).rem_euclid(7))
    }
}

/// Semester dates used when the SIA does not publish them for a group.
#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Term {
    pub from: NaiveDate,
    pub until: NaiveDate,
    /// Prefer the dates the SIA publishes per group over `from`/`until`.
    #[serde(default = "yes")]
    pub use_group_dates: bool,
}

fn yes() -> bool {
    true
}

impl Term {
    pub fn validate(&self) -> Result<()> {
        if self.until < self.from {
            return Err(Error::Invalid(
                "La fecha de fin del semestre es anterior a la de inicio.".into(),
            ));
        }
        Ok(())
    }
}

/// One weekly event per class and personal block of `schedule`. Classes that never fall between
/// their dates (a Thursday class in a Monday-to-Wednesday range) are left out, so exporters can
/// write every event they receive.
pub fn events_for(
    schedule: &Schedule,
    courses: &[Course],
    term: Term,
    colors: &dyn Fn(&str) -> Option<String>,
) -> Vec<CalendarEvent> {
    let mut out = Vec::new();
    for sel in &schedule.selections {
        let Some(course) = courses.iter().find(|c| c.code == sel.course_code) else {
            continue;
        };
        let Some(group) = course.group(&sel.group_id) else {
            continue;
        };
        let (from, until) = match (term.use_group_dates, group.starts_on, group.ends_on) {
            (true, Some(a), Some(b)) => (a, b),
            _ => (term.from, term.until),
        };
        for s in &group.sessions {
            out.push(CalendarEvent {
                summary: course.name.clone(),
                location: s.room.clone(),
                description: format!(
                    "{} · Grupo {}\nProfesor: {}\nFacultad: {}\nCréditos: {}",
                    course.code,
                    group.id,
                    group.professor_line(),
                    if group.faculty.is_empty() {
                        "—"
                    } else {
                        &group.faculty
                    },
                    course.credits
                ),
                day: s.day,
                start: s.start,
                end: s.end,
                from,
                until,
                color: colors(&course.code),
            });
        }
    }
    for b in &schedule.blocks {
        out.push(CalendarEvent {
            summary: if b.label.is_empty() {
                "Bloque personal".into()
            } else {
                b.label.clone()
            },
            location: String::new(),
            description: String::new(),
            day: b.day,
            start: b.start,
            end: b.end,
            from: term.from,
            until: term.until,
            color: None,
        });
    }
    out.retain(|e| e.first_date() <= e.until);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn first_date_moves_forward_to_weekday() {
        let e = CalendarEvent {
            summary: String::new(),
            location: String::new(),
            description: String::new(),
            day: Day::Thu,
            start: 0,
            end: 60,
            from: NaiveDate::from_ymd_opt(2026, 8, 24).unwrap(), // Monday
            until: NaiveDate::from_ymd_opt(2026, 12, 17).unwrap(),
            color: None,
        };
        assert_eq!(
            e.first_date(),
            NaiveDate::from_ymd_opt(2026, 8, 27).unwrap()
        );
    }

    fn date(d: u32) -> NaiveDate {
        NaiveDate::from_ymd_opt(2026, 8, d).unwrap()
    }

    fn term(from: u32, until: u32) -> Term {
        Term {
            from: date(from),
            until: date(until),
            use_group_dates: false,
        }
    }

    #[test]
    fn term_rejects_end_before_start() {
        assert!(term(24, 24).validate().is_ok());
        assert!(term(24, 30).validate().is_ok());
        let err = term(30, 24).validate().unwrap_err();
        assert_eq!(
            err.to_string(),
            "La fecha de fin del semestre es anterior a la de inicio."
        );
    }

    #[test]
    fn classes_that_never_happen_in_the_term_are_dropped() {
        use crate::model::{CourseSource, Group, Session, Typology};
        use crate::scheduler::Selection;

        let session = |day| Session {
            day,
            start: 7 * 60,
            end: 9 * 60,
            room: String::new(),
        };
        let course = Course {
            code: "A".into(),
            name: "Curso A".into(),
            credits: 3,
            typology: Typology::Other,
            groups: vec![Group {
                id: "1".into(),
                label: "Grupo 1".into(),
                professors: vec![],
                faculty: String::new(),
                sessions: vec![session(Day::Tue), session(Day::Thu)],
                duration: String::new(),
                shift: String::new(),
                spots: None,
                starts_on: None,
                ends_on: None,
            }],
            fetched_at: chrono::Utc::now(),
            source: CourseSource::Sia,
            career: None,
        };
        let mut schedule = Schedule::new("2026-2");
        schedule.selections.push(Selection {
            course_code: "A".into(),
            group_id: "1".into(),
        });

        // Monday 24 to Wednesday 26: the Tuesday class happens, the Thursday one never does.
        let events = events_for(&schedule, &[course], term(24, 26), &|_| None);
        let days: Vec<Day> = events.iter().map(|e| e.day).collect();
        assert_eq!(days, vec![Day::Tue]);
    }
}
