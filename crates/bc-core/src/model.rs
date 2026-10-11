//! Domain types shared by every module and sent to the UI as camelCase JSON.

use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};

use crate::text::normalize;

#[derive(Copy, Clone, Debug, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum Day {
    Mon,
    Tue,
    Wed,
    Thu,
    Fri,
    Sat,
    Sun,
}

impl Day {
    pub const ALL: [Day; 7] = [
        Day::Mon,
        Day::Tue,
        Day::Wed,
        Day::Thu,
        Day::Fri,
        Day::Sat,
        Day::Sun,
    ];

    /// 0 = Monday … 6 = Sunday.
    pub fn index(self) -> usize {
        self as usize
    }

    pub fn from_spanish(s: &str) -> Option<Day> {
        Some(match normalize(s).as_str() {
            "LUNES" => Day::Mon,
            "MARTES" => Day::Tue,
            "MIERCOLES" => Day::Wed,
            "JUEVES" => Day::Thu,
            "VIERNES" => Day::Fri,
            "SABADO" => Day::Sat,
            "DOMINGO" => Day::Sun,
            _ => return None,
        })
    }

    pub fn spanish(self) -> &'static str {
        [
            "Lunes",
            "Martes",
            "Miércoles",
            "Jueves",
            "Viernes",
            "Sábado",
            "Domingo",
        ][self.index()]
    }

    pub fn ical(self) -> &'static str {
        ["MO", "TU", "WE", "TH", "FR", "SA", "SU"][self.index()]
    }

    pub fn chrono(self) -> chrono::Weekday {
        use chrono::Weekday::*;
        [Mon, Tue, Wed, Thu, Fri, Sat, Sun][self.index()]
    }
}

/// One weekly meeting of a group. Times are minutes since midnight, `end` exclusive.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    pub day: Day,
    pub start: u16,
    pub end: u16,
    #[serde(default)]
    pub room: String,
}

impl Session {
    pub fn overlaps(&self, other: &Session) -> bool {
        self.day == other.day && self.start < other.end && other.start < self.end
    }

    pub fn duration(&self) -> u16 {
        self.end.saturating_sub(self.start)
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Group {
    /// Stable key inside its course: the SIA group number ("1", "SUMA-02", "33C").
    pub id: String,
    /// Full SIA label, e.g. "(1) Grupo 1 - BIOLOGIA".
    pub label: String,
    #[serde(default)]
    pub professors: Vec<String>,
    #[serde(default)]
    pub faculty: String,
    #[serde(default)]
    pub sessions: Vec<Session>,
    #[serde(default)]
    pub duration: String,
    #[serde(default)]
    pub shift: String,
    /// `None` when the SIA does not publish spots for the group.
    #[serde(default)]
    pub spots: Option<u32>,
    #[serde(default)]
    pub starts_on: Option<NaiveDate>,
    #[serde(default)]
    pub ends_on: Option<NaiveDate>,
}

impl Group {
    pub fn professor_line(&self) -> String {
        if self.professors.is_empty() {
            "No informado".into()
        } else {
            self.professors.join(", ")
        }
    }

    pub fn has_spots(&self) -> bool {
        self.spots.is_none_or(|s| s > 0)
    }
}

#[derive(Copy, Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum Typology {
    FundObligatoria,
    FundOptativa,
    DiscObligatoria,
    DiscOptativa,
    LibreEleccion,
    Nivelacion,
    TrabajoGrado,
    Other,
}

impl Typology {
    pub fn parse(s: &str) -> Typology {
        let n = normalize(s);
        let has = |w: &str| n.contains(w);
        if has("NIVELACION") {
            Typology::Nivelacion
        } else if has("TRABAJO DE GRADO") {
            Typology::TrabajoGrado
        } else if has("LIBRE") {
            Typology::LibreEleccion
        } else if has("FUND") {
            if has("OPTATIVA") {
                Typology::FundOptativa
            } else {
                Typology::FundObligatoria
            }
        } else if has("DISCIPLINAR") || has("PROFESIONAL") {
            if has("OPTATIVA") {
                Typology::DiscOptativa
            } else {
                Typology::DiscObligatoria
            }
        } else {
            Typology::Other
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            Typology::FundObligatoria => "FUND. OBLIGATORIA",
            Typology::FundOptativa => "FUND. OPTATIVA",
            Typology::DiscObligatoria => "DISCIPLINAR OBLIGATORIA",
            Typology::DiscOptativa => "DISCIPLINAR OPTATIVA",
            Typology::LibreEleccion => "LIBRE ELECCIÓN",
            Typology::Nivelacion => "NIVELACIÓN",
            Typology::TrabajoGrado => "TRABAJO DE GRADO",
            Typology::Other => "OTRA",
        }
    }
}

#[derive(Copy, Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum CourseSource {
    #[default]
    Sia,
    Manual,
}

/// The four dropdown values that identify a study plan in the SIA catalog, plus how
/// it was looked up. `key` is the familiar "level-campus-faculty-plan" search code.
#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CareerRef {
    pub level: String,
    pub campus: String,
    pub faculty: String,
    pub plan: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub electives: bool,
}

impl CareerRef {
    pub fn key(&self) -> String {
        format!(
            "{}-{}-{}-{}{}",
            self.level,
            self.campus,
            self.faculty,
            self.plan,
            if self.electives { "-E" } else { "" }
        )
    }

    /// Build from a legacy search code such as "0-2-8-3".
    pub fn from_search_code(code: &str, electives: bool) -> Option<CareerRef> {
        let parts: Vec<&str> = code.split('-').collect();
        if parts.len() != 4 || parts.iter().any(|p| p.parse::<u32>().is_err()) {
            return None;
        }
        Some(CareerRef {
            level: parts[0].into(),
            campus: parts[1].into(),
            faculty: parts[2].into(),
            plan: parts[3].into(),
            name: String::new(),
            electives,
        })
    }
}

/// A row of the catalog table, before the course page is opened.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CourseSummary {
    pub code: String,
    pub name: String,
    pub credits: Option<u8>,
    pub typology: Typology,
    /// Position of the row in the SIA table; needed to open the course page.
    pub row: usize,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Course {
    pub code: String,
    pub name: String,
    pub credits: u8,
    pub typology: Typology,
    pub groups: Vec<Group>,
    pub fetched_at: DateTime<Utc>,
    #[serde(default)]
    pub source: CourseSource,
    #[serde(default)]
    pub career: Option<CareerRef>,
}

impl Course {
    pub fn group(&self, id: &str) -> Option<&Group> {
        self.groups.iter().find(|g| g.id == id)
    }

    pub fn available_spots(&self) -> u32 {
        self.groups.iter().filter_map(|g| g.spots).sum()
    }

    pub fn title(&self) -> String {
        format!("{} ({})", self.name, self.code)
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrereqRef {
    pub code: String,
    pub name: String,
}

/// Kind letters used by the SIA for prerequisite conditions.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Condition {
    pub number: u32,
    /// M, O, A, I, E, D or Y.
    pub kind: String,
    /// `true` when every listed course is required ("¿Todas? [S]").
    pub all: bool,
    /// How many of the listed courses are required when `all` is false.
    pub required: Option<u32>,
    pub courses: Vec<PrereqRef>,
}

impl Condition {
    pub fn is_corequisite(&self) -> bool {
        matches!(self.kind.as_str(), "I" | "E" | "D")
    }

    pub fn needed(&self) -> usize {
        if self.all {
            self.courses.len()
        } else {
            self.required
                .map(|r| r as usize)
                .unwrap_or(1)
                .min(self.courses.len())
        }
    }

    pub fn description(&self) -> &'static str {
        match self.kind.as_str() {
            "M" => "No se puede matricular sin superar el prerrequisito",
            "O" => "Se puede matricular, pero no ser calificada sin superar el prerrequisito",
            "A" => "Anulación por incompatibilidad si no se supera la asignatura llave",
            "I" => "Asignaturas incluyentes",
            "E" => "Asignaturas excluyentes",
            "D" => "Diferido",
            _ => "Sin descripción",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CoursePrereqs {
    pub code: String,
    pub name: String,
    pub credits: u8,
    pub typology: Typology,
    pub conditions: Vec<Condition>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn typologies_from_sia_labels() {
        assert_eq!(
            Typology::parse("FUND. OBLIGATORIA (B)"),
            Typology::FundObligatoria
        );
        assert_eq!(
            Typology::parse(" DISCIPLINAR OPTATIVA"),
            Typology::DiscOptativa
        );
        assert_eq!(
            Typology::parse("LIBRE ELECCIÓN (L)"),
            Typology::LibreEleccion
        );
        assert_eq!(Typology::parse("NIVELACIÓN"), Typology::Nivelacion);
    }

    #[test]
    fn days_from_spanish() {
        assert_eq!(Day::from_spanish("MIÉRCOLES"), Some(Day::Wed));
        assert_eq!(Day::from_spanish("sabado"), Some(Day::Sat));
        assert_eq!(Day::from_spanish("x"), None);
    }

    #[test]
    fn career_keys_round_trip() {
        let c = CareerRef::from_search_code("0-2-8-3", false).unwrap();
        assert_eq!(c.key(), "0-2-8-3");
        assert!(CareerRef::from_search_code("0-2-8", false).is_none());
    }
}
