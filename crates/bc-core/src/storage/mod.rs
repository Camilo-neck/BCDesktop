//! Local persistence in one SQLite file.
//!
//! Replaces MongoDB (server) and `localStorage` (browser). Domain objects are
//! stored as JSON documents keyed by their natural id; the columns next to them
//! exist only for ordering and expiry. Migrations are versioned with
//! `PRAGMA user_version`.

use std::path::Path;

use chrono::{DateTime, Duration, Utc};
use rusqlite::{params, Connection, OptionalExtension};
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::academic::AcademicHistory;
use crate::error::{Error, Result};
use crate::model::{Course, CoursePrereqs};
use crate::scheduler::{Schedule, Selection};

const MIGRATIONS: &[&str] = &[
    // v1
    r#"
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE courses (
        code TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        color TEXT NOT NULL,
        added_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    );
    CREATE TABLE favorites (course_code TEXT NOT NULL, group_id TEXT NOT NULL, PRIMARY KEY (course_code, group_id));
    CREATE TABLE schedules (
        id TEXT PRIMARY KEY,
        position INTEGER NOT NULL,
        data TEXT NOT NULL
    );
    CREATE TABLE cache (key TEXT PRIMARY KEY, value TEXT NOT NULL, expires_at TEXT NOT NULL);
    CREATE TABLE histories (id INTEGER PRIMARY KEY AUTOINCREMENT, raw TEXT NOT NULL, parsed TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE prereqs (career_key TEXT PRIMARY KEY, career_name TEXT NOT NULL, data TEXT NOT NULL, fetched_at TEXT NOT NULL);
    "#,
];

/// Colors assigned to new courses in order (same palette as the web app).
pub const PALETTE: [&str; 10] = [
    "#388e3c", "#1976d2", "#7b1fa2", "#d32f2f", "#f57c00", "#303f9f", "#00897b", "#c2185b",
    "#5d4037", "#0288d1",
];

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryCourse {
    pub course: Course,
    pub color: String,
    pub added_at: DateTime<Utc>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredHistory {
    pub id: i64,
    pub history: AcademicHistory,
    pub created_at: DateTime<Utc>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredPlan {
    pub career_key: String,
    pub career_name: String,
    pub courses: Vec<CoursePrereqs>,
    pub fetched_at: DateTime<Utc>,
}

pub struct Db {
    conn: Connection,
}

fn now() -> String {
    Utc::now().to_rfc3339()
}

fn parse_time(s: &str) -> DateTime<Utc> {
    DateTime::parse_from_rfc3339(s)
        .map(|d| d.with_timezone(&Utc))
        .unwrap_or_else(|_| Utc::now())
}

impl Db {
    pub fn open(path: &Path) -> Result<Db> {
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir)?;
        }
        Self::init(Connection::open(path)?)
    }

    pub fn in_memory() -> Result<Db> {
        Self::init(Connection::open_in_memory()?)
    }

    fn init(conn: Connection) -> Result<Db> {
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "foreign_keys", "ON")?;
        let version: i64 = conn.pragma_query_value(None, "user_version", |r| r.get(0))?;
        for (i, sql) in MIGRATIONS.iter().enumerate().skip(version as usize) {
            conn.execute_batch(&format!(
                "BEGIN; {sql}; PRAGMA user_version = {}; COMMIT;",
                i + 1
            ))?;
        }
        Ok(Db { conn })
    }

    // ------------------------------------------------------------- settings

    pub fn settings(&self) -> Result<serde_json::Map<String, Value>> {
        let mut stmt = self.conn.prepare("SELECT key, value FROM settings")?;
        let rows = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?;
        let mut out = serde_json::Map::new();
        for row in rows {
            let (k, v) = row?;
            out.insert(k, serde_json::from_str(&v).unwrap_or(Value::Null));
        }
        Ok(out)
    }

    pub fn setting<T: DeserializeOwned>(&self, key: &str) -> Result<Option<T>> {
        let v: Option<String> = self
            .conn
            .query_row("SELECT value FROM settings WHERE key = ?1", [key], |r| {
                r.get(0)
            })
            .optional()?;
        Ok(v.and_then(|s| serde_json::from_str(&s).ok()))
    }

    pub fn set_setting(&self, key: &str, value: &Value) -> Result<()> {
        if value.is_null() {
            self.conn
                .execute("DELETE FROM settings WHERE key = ?1", [key])?;
        } else {
            self.conn.execute(
                "INSERT INTO settings (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                params![key, value.to_string()],
            )?;
        }
        Ok(())
    }

    // ---------------------------------------------------------------- cache

    pub fn cache_get<T: DeserializeOwned>(&self, key: &str) -> Result<Option<T>> {
        let row: Option<(String, String)> = self
            .conn
            .query_row(
                "SELECT value, expires_at FROM cache WHERE key = ?1",
                [key],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()?;
        match row {
            Some((v, exp)) if parse_time(&exp) > Utc::now() => Ok(serde_json::from_str(&v).ok()),
            _ => Ok(None),
        }
    }

    pub fn cache_put<T: Serialize>(&self, key: &str, value: &T, ttl: Duration) -> Result<()> {
        self.conn.execute(
            "INSERT INTO cache (key, value, expires_at) VALUES (?1, ?2, ?3)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value, expires_at = excluded.expires_at",
            params![key, serde_json::to_string(value)?, (Utc::now() + ttl).to_rfc3339()],
        )?;
        Ok(())
    }

    pub fn cache_clear(&self) -> Result<usize> {
        Ok(self.conn.execute("DELETE FROM cache", [])?)
    }

    pub fn cache_purge_expired(&self) -> Result<usize> {
        Ok(self
            .conn
            .execute("DELETE FROM cache WHERE expires_at < ?1", [now()])?)
    }

    // -------------------------------------------------------------- courses

    pub fn library(&self) -> Result<Vec<LibraryCourse>> {
        let mut stmt = self
            .conn
            .prepare("SELECT data, color, added_at FROM courses ORDER BY added_at, code")?;
        let rows = stmt.query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
            ))
        })?;
        let mut out = Vec::new();
        for row in rows {
            let (data, color, added) = row?;
            out.push(LibraryCourse {
                course: serde_json::from_str(&data)?,
                color,
                added_at: parse_time(&added),
            });
        }
        Ok(out)
    }

    pub fn library_course(&self, code: &str) -> Result<Option<Course>> {
        let v: Option<String> = self
            .conn
            .query_row("SELECT data FROM courses WHERE code = ?1", [code], |r| {
                r.get(0)
            })
            .optional()?;
        v.map(|s| serde_json::from_str(&s).map_err(Error::from))
            .transpose()
    }

    /// Insert or refresh courses, keeping the color of those already present.
    pub fn upsert_courses(&mut self, courses: &[Course]) -> Result<()> {
        let tx = self.conn.transaction()?;
        let count: i64 = tx.query_row("SELECT COUNT(*) FROM courses", [], |r| r.get(0))?;
        let mut next = count as usize;
        for c in courses {
            let exists: bool = tx.query_row(
                "SELECT EXISTS(SELECT 1 FROM courses WHERE code = ?1)",
                [&c.code],
                |r| r.get(0),
            )?;
            let data = serde_json::to_string(c)?;
            if exists {
                tx.execute(
                    "UPDATE courses SET data = ?2, updated_at = ?3 WHERE code = ?1",
                    params![c.code, data, now()],
                )?;
            } else {
                let color = PALETTE[next % PALETTE.len()];
                next += 1;
                tx.execute(
                    "INSERT INTO courses (code, data, color, added_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?4)",
                    params![c.code, data, color, now()],
                )?;
            }
        }
        tx.commit()?;
        Ok(())
    }

    pub fn set_course_color(&self, code: &str, color: &str) -> Result<()> {
        self.conn.execute(
            "UPDATE courses SET color = ?2 WHERE code = ?1",
            params![code, color],
        )?;
        Ok(())
    }

    /// Remove a course and every selection of it in every schedule.
    pub fn remove_course(&mut self, code: &str) -> Result<()> {
        let mut schedules = self.schedules()?;
        let tx = self.conn.transaction()?;
        tx.execute("DELETE FROM courses WHERE code = ?1", [code])?;
        tx.execute("DELETE FROM favorites WHERE course_code = ?1", [code])?;
        for (pos, s) in schedules.iter_mut().enumerate() {
            let before = s.selections.len();
            s.selections.retain(|x| x.course_code != code);
            if s.selections.len() != before {
                s.updated_at = Utc::now();
                tx.execute(
                    "UPDATE schedules SET data = ?2, position = ?3 WHERE id = ?1",
                    params![s.id, serde_json::to_string(&s)?, pos as i64],
                )?;
            }
        }
        tx.commit()?;
        Ok(())
    }

    // ------------------------------------------------------------ favorites

    pub fn favorites(&self) -> Result<Vec<Selection>> {
        let mut stmt = self
            .conn
            .prepare("SELECT course_code, group_id FROM favorites")?;
        let rows = stmt.query_map([], |r| {
            Ok(Selection {
                course_code: r.get(0)?,
                group_id: r.get(1)?,
            })
        })?;
        Ok(rows.collect::<std::result::Result<_, _>>()?)
    }

    pub fn toggle_favorite(&self, sel: &Selection) -> Result<bool> {
        let removed = self.conn.execute(
            "DELETE FROM favorites WHERE course_code = ?1 AND group_id = ?2",
            params![sel.course_code, sel.group_id],
        )?;
        if removed == 0 {
            self.conn.execute(
                "INSERT INTO favorites (course_code, group_id) VALUES (?1, ?2)",
                params![sel.course_code, sel.group_id],
            )?;
        }
        Ok(removed == 0)
    }

    // ------------------------------------------------------------ schedules

    pub fn schedules(&self) -> Result<Vec<Schedule>> {
        let mut stmt = self
            .conn
            .prepare("SELECT data FROM schedules ORDER BY position")?;
        let rows = stmt.query_map([], |r| r.get::<_, String>(0))?;
        let mut out = Vec::new();
        for row in rows {
            out.push(serde_json::from_str(&row?)?);
        }
        Ok(out)
    }

    pub fn save_schedule(&self, s: &Schedule) -> Result<()> {
        let pos: i64 = self
            .conn
            .query_row(
                "SELECT position FROM schedules WHERE id = ?1",
                [&s.id],
                |r| r.get(0),
            )
            .optional()?
            .map_or_else(
                || {
                    self.conn.query_row(
                        "SELECT COALESCE(MAX(position) + 1, 0) FROM schedules",
                        [],
                        |r| r.get(0),
                    )
                },
                Ok,
            )?;
        self.conn.execute(
            "INSERT INTO schedules (id, position, data) VALUES (?1, ?2, ?3)
             ON CONFLICT(id) DO UPDATE SET data = excluded.data",
            params![s.id, pos, serde_json::to_string(s)?],
        )?;
        Ok(())
    }

    pub fn delete_schedule(&self, id: &str) -> Result<()> {
        self.conn
            .execute("DELETE FROM schedules WHERE id = ?1", [id])?;
        Ok(())
    }

    pub fn reorder_schedules(&mut self, ids: &[String]) -> Result<()> {
        let tx = self.conn.transaction()?;
        for (i, id) in ids.iter().enumerate() {
            tx.execute(
                "UPDATE schedules SET position = ?2 WHERE id = ?1",
                params![id, i as i64],
            )?;
        }
        tx.commit()?;
        Ok(())
    }

    // ------------------------------------------------------------ histories

    pub fn save_history(&self, raw: &str, h: &AcademicHistory) -> Result<StoredHistory> {
        let at = now();
        self.conn.execute(
            "INSERT INTO histories (raw, parsed, created_at) VALUES (?1, ?2, ?3)",
            params![raw, serde_json::to_string(h)?, at],
        )?;
        Ok(StoredHistory {
            id: self.conn.last_insert_rowid(),
            history: h.clone(),
            created_at: parse_time(&at),
        })
    }

    pub fn latest_history(&self) -> Result<Option<StoredHistory>> {
        let row: Option<(i64, String, String)> = self
            .conn
            .query_row(
                "SELECT id, parsed, created_at FROM histories ORDER BY id DESC LIMIT 1",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .optional()?;
        row.map(|(id, p, at)| {
            Ok(StoredHistory {
                id,
                history: serde_json::from_str(&p)?,
                created_at: parse_time(&at),
            })
        })
        .transpose()
    }

    pub fn delete_histories(&self) -> Result<()> {
        self.conn.execute("DELETE FROM histories", [])?;
        Ok(())
    }

    // -------------------------------------------------------------- prereqs

    pub fn plan(&self, career_key: &str) -> Result<Option<StoredPlan>> {
        let row: Option<(String, String, String)> = self
            .conn
            .query_row(
                "SELECT career_name, data, fetched_at FROM prereqs WHERE career_key = ?1",
                [career_key],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .optional()?;
        row.map(|(name, data, at)| {
            Ok(StoredPlan {
                career_key: career_key.into(),
                career_name: name,
                courses: serde_json::from_str(&data)?,
                fetched_at: parse_time(&at),
            })
        })
        .transpose()
    }

    pub fn plans(&self) -> Result<Vec<(String, String, DateTime<Utc>)>> {
        let mut stmt = self.conn.prepare(
            "SELECT career_key, career_name, fetched_at FROM prereqs ORDER BY fetched_at DESC",
        )?;
        let rows = stmt.query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
            ))
        })?;
        let mut out = Vec::new();
        for r in rows {
            let (k, n, t) = r?;
            out.push((k, n, parse_time(&t)));
        }
        Ok(out)
    }

    pub fn save_plan(
        &self,
        career_key: &str,
        career_name: &str,
        courses: &[CoursePrereqs],
    ) -> Result<()> {
        self.conn.execute(
            "INSERT INTO prereqs (career_key, career_name, data, fetched_at) VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(career_key) DO UPDATE SET career_name = excluded.career_name, data = excluded.data, fetched_at = excluded.fetched_at",
            params![career_key, career_name, serde_json::to_string(courses)?, now()],
        )?;
        Ok(())
    }

    pub fn delete_plan(&self, career_key: &str) -> Result<()> {
        self.conn
            .execute("DELETE FROM prereqs WHERE career_key = ?1", [career_key])?;
        Ok(())
    }

    /// Delete everything the student created. Settings survive unless `settings` is true.
    pub fn reset(&self, settings: bool) -> Result<()> {
        self.conn.execute_batch(
            "DELETE FROM courses; DELETE FROM favorites; DELETE FROM schedules; DELETE FROM cache; DELETE FROM histories; DELETE FROM prereqs;",
        )?;
        if settings {
            self.conn.execute("DELETE FROM settings", [])?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{CourseSource, Typology};

    fn course(code: &str) -> Course {
        Course {
            code: code.into(),
            name: code.into(),
            credits: 3,
            typology: Typology::Other,
            groups: vec![],
            fetched_at: Utc::now(),
            source: CourseSource::Sia,
            career: None,
        }
    }

    #[test]
    fn courses_keep_color_and_cascade_delete() {
        let mut db = Db::in_memory().unwrap();
        db.upsert_courses(&[course("A"), course("B")]).unwrap();
        db.set_course_color("A", "#000000").unwrap();
        db.upsert_courses(&[course("A")]).unwrap();
        let lib = db.library().unwrap();
        assert_eq!(lib.len(), 2);
        assert_eq!(lib[0].color, "#000000");

        let mut s = Schedule::new("2026-2");
        s.selections.push(Selection {
            course_code: "A".into(),
            group_id: "1".into(),
        });
        db.save_schedule(&s).unwrap();
        db.remove_course("A").unwrap();
        assert!(db.schedules().unwrap()[0].selections.is_empty());
    }

    #[test]
    fn cache_expires() {
        let db = Db::in_memory().unwrap();
        db.cache_put("k", &vec![1, 2], Duration::seconds(60))
            .unwrap();
        assert_eq!(db.cache_get::<Vec<i32>>("k").unwrap(), Some(vec![1, 2]));
        db.cache_put("old", &1, Duration::seconds(-1)).unwrap();
        assert_eq!(db.cache_get::<i32>("old").unwrap(), None);
    }

    #[test]
    fn favorites_toggle_and_schedule_order() {
        let mut db = Db::in_memory().unwrap();
        let sel = Selection {
            course_code: "A".into(),
            group_id: "1".into(),
        };
        assert!(db.toggle_favorite(&sel).unwrap());
        assert!(!db.toggle_favorite(&sel).unwrap());
        let (a, b) = (Schedule::new("a"), Schedule::new("b"));
        db.save_schedule(&a).unwrap();
        db.save_schedule(&b).unwrap();
        db.reorder_schedules(&[b.id.clone(), a.id.clone()]).unwrap();
        assert_eq!(db.schedules().unwrap()[0].name, "b");
    }
}
