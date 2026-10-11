//! Academic history: parser for the text the student copies from the SIA
//! ("Mi historia académica") and the GPA calculators built on it.
//!
//! The regular expressions are the ones the web backend validated over real
//! histories; the output is a typed struct instead of nested dictionaries.

use std::collections::{BTreeMap, HashMap};
use std::sync::LazyLock;

use regex::Regex;
use serde::{Deserialize, Serialize};

use crate::error::{Error, Result};
use crate::model::Typology;

macro_rules! re {
    ($name:ident, $pat:expr) => {
        static $name: LazyLock<Regex> = LazyLock::new(|| Regex::new($pat).expect("valid regex"));
    };
}

re!(PLAN_MAIN, r"Plan de estudios\s*\n(.*)\n");
re!(
    PLANS,
    r"(\d[A-Z|\d]\d{2})?\s*([A-ZÁ-Ú][á-úa-zÁ-ÚA-Z ,:-]*[a-zA-Z])"
);
re!(FACULTY, r"Facultad: ([A-ZÁ-Ú][á-úa-zÁ-ÚA-Z ,:-]*[a-zA-Z])");
re!(STATUS, r"Hist\. Acad\.: \d{1,5}([A-ZÁ-Ú ]*)");
re!(PAPA, r"(\d.\d) \(Acumulado\)\n?(\w*) - P\.A\.P\.A");
re!(PA, r"(\d.\d) \(Acumulado\)\n?(\w*) - Promedio académico");
re!(
    COURSE,
    r"(.+) \((.+)\)\s+(\d)\s+(.+)\s+(\d{4}-\d)S Ordinaria\t(\d\.\d)"
);
re!(
    COURSE_NO_GRADE,
    r"([A-Za-zá-úÁ-Ú,:\- \(\)]+[A-Za-zá-úÁ-Ú\),:\-]) \((\d+[-A-Z]*)\)\t(\d)\t([A-Za-zá-úÁ-Ú\. ]+)\t(\d{4}-\d)S [A-Za-z ]+\t\n(APROBADA|REPROBADA)"
);
re!(
    CREDITS_ROW,
    r"([A-ZÁ-Ú .]+)\t(\d+)\t(\d+)\t(\d+)\t(\d+)\t(\d+)"
);
re!(SURPLUS, r"Total Créditos Excedentes(\d*)");
re!(
    CANCELLED,
    r"Total de Créditos Cancelados en los Periodos Cursado(\d*)"
);
re!(PROGRESS, r"Porcentaje de Avance(\d*[.,]\d*)%");
re!(ADDITIONAL, r"Créditos adicionales(\d*)");
re!(QUOTA, r"Cupo de créditos(\d+)");
re!(AVAILABLE, r"Créditos disponibles(\-?\d*)");
re!(DOUBLE_DEGREE, r"Créditos de estudio doble titulación(\d*)");
re!(USERNAME, r"([a-zA-Z0-9]+)\s*\n\s*Datos personales");

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreditSummary {
    pub required: u32,
    pub approved: u32,
    pub pending: u32,
    pub enrolled: u32,
    pub taken: u32,
    /// approved / required, in percent.
    pub progress: f64,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TakenCourse {
    pub code: String,
    pub name: String,
    pub credits: u32,
    pub typology: Typology,
    pub typology_label: String,
    pub period: String,
    /// `None` for courses graded only as APROBADA/REPROBADA.
    pub grade: Option<f64>,
    pub passed: bool,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Period {
    pub name: String,
    pub courses: Vec<TakenCourse>,
    pub credits: u32,
    pub leveling_credits: u32,
    pub approved_credits: u32,
    pub approved_leveling_credits: u32,
    pub ungraded_credits: u32,
    /// Period average (PAPI).
    pub papi: Option<f64>,
    /// PAPA and PA accumulated up to this period.
    pub papa: Option<f64>,
    pub pa: Option<f64>,
    pub progress: f64,
    pub accumulated_progress: f64,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreditQuota {
    pub additional: u32,
    pub quota: u32,
    pub available: i32,
    pub double_degree: u32,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AcademicHistory {
    pub username: Option<String>,
    pub plan: String,
    pub faculty: String,
    pub status: String,
    pub papa: Option<f64>,
    pub pa: Option<f64>,
    /// Keyed by the SIA row label ("FUND. OBLIGATORIA", "TOTAL", ...).
    pub credits: BTreeMap<String, CreditSummary>,
    pub progress: f64,
    pub progress_fundamental: f64,
    pub progress_disciplinary: f64,
    pub progress_electives: f64,
    pub surplus_credits: u32,
    pub cancelled_credits: u32,
    pub quota: CreditQuota,
    pub periods: Vec<Period>,
    pub average_progress: f64,
    pub courses_seen: u32,
    pub highest_grade: f64,
    pub highest_grade_count: u32,
    pub lowest_grade: f64,
    pub lowest_grade_count: u32,
}

fn round(x: f64, digits: i32) -> f64 {
    let p = 10f64.powi(digits);
    (x * p).round() / p
}

fn first<'a>(re: &Regex, txt: &'a str, group: usize) -> Option<&'a str> {
    re.captures(txt)
        .and_then(|c| c.get(group))
        .map(|m| m.as_str())
}

fn count(re: &Regex, txt: &str) -> usize {
    re.find_iter(txt).count()
}

fn parse_f(s: &str) -> Option<f64> {
    s.replace(',', ".").parse().ok()
}

/// True when the text looks like a history of a student without any course yet.
pub fn is_empty_history(txt: &str) -> bool {
    let has_ungraded = count(&COURSE_NO_GRADE, txt) > 0;
    let has_graded = count(&COURSE, txt) > 0;
    let progress_not_zero = first(&PROGRESS, txt, 1)
        .and_then(parse_f)
        .is_none_or(|p| p > 0.0);
    !(has_ungraded || has_graded || progress_not_zero)
}

/// Checks the fields every complete history has, and says which one is missing.
pub fn validate(txt: &str) -> Result<()> {
    let missing = |what: &str| {
        Err(Error::Invalid(format!(
            "No se encontró {what}. Copia la página completa de la historia académica."
        )))
    };
    if count(&CREDITS_ROW, txt) != 9 {
        return missing("la tabla de créditos por tipología");
    }
    if count(&COURSE, txt) < 1 {
        return missing("ninguna asignatura con nota");
    }
    match first(&PLAN_MAIN, txt, 1) {
        Some(p) if PLANS.is_match(p) => {}
        _ => return missing("el plan de estudios"),
    }
    let singles: [(&Regex, &str); 10] = [
        (&FACULTY, "la facultad"),
        (&STATUS, "el estado de la historia"),
        (&PAPA, "el P.A.P.A."),
        (&PA, "el promedio académico"),
        (&SURPLUS, "los créditos excedentes"),
        (&CANCELLED, "los créditos cancelados"),
        (&PROGRESS, "el porcentaje de avance"),
        (&ADDITIONAL, "los créditos adicionales"),
        (&QUOTA, "el cupo de créditos"),
        (&AVAILABLE, "los créditos disponibles"),
    ];
    for (re, what) in singles {
        if count(re, txt) != 1 {
            return missing(what);
        }
    }
    Ok(())
}

pub fn parse(txt: &str) -> Result<AcademicHistory> {
    let txt = txt.replace("\r\n", "\n");
    let txt = txt.as_str();
    let empty = is_empty_history(txt);
    if !empty {
        validate(txt)?;
    }
    let need = |re: &Regex, what: &str| -> Result<String> {
        first(re, txt, 1)
            .map(str::to_owned)
            .ok_or_else(|| Error::Invalid(format!("No se encontró {what}.")))
    };

    let plan_line = need(&PLAN_MAIN, "el plan de estudios")?;
    let plan = PLANS
        .captures(&plan_line)
        .map(|c| {
            format!("{} {}", c.get(1).map_or("", |m| m.as_str()), &c[2])
                .trim()
                .to_owned()
        })
        .unwrap_or(plan_line);

    let mut credits = BTreeMap::new();
    for c in CREDITS_ROW.captures_iter(txt) {
        let n = |i: usize| c[i].parse::<u32>().unwrap_or(0);
        let (required, approved) = (n(2), n(3));
        credits.insert(
            c[1].trim().to_owned(),
            CreditSummary {
                required,
                approved,
                pending: n(4),
                enrolled: n(5),
                taken: n(6),
                progress: if required == 0 {
                    0.0
                } else {
                    round(approved as f64 / required as f64 * 100.0, 1)
                },
            },
        );
    }
    let cr = |k: &str| credits.get(k).cloned().unwrap_or_default();
    let pct = |a: u32, r: u32| {
        if r == 0 {
            0.0
        } else {
            round(a as f64 * 100.0 / r as f64, 1)
        }
    };
    let (fo, fp, dobl, dopt) = (
        cr("FUND. OBLIGATORIA"),
        cr("FUND. OPTATIVA"),
        cr("DISCIPLINAR OBLIGATORIA"),
        cr("DISCIPLINAR OPTATIVA"),
    );
    let total_required = cr("TOTAL").required;

    let mut periods: BTreeMap<String, Period> = BTreeMap::new();
    let mut add = |course: TakenCourse| {
        let p = periods
            .entry(course.period.clone())
            .or_insert_with(|| Period {
                name: course.period.clone(),
                ..Default::default()
            });
        let leveling = course.typology == Typology::Nivelacion;
        if course.grade.is_none() {
            p.ungraded_credits += course.credits;
        }
        if leveling {
            p.leveling_credits += course.credits;
            if course.passed {
                p.approved_leveling_credits += course.credits;
            }
        } else {
            p.credits += course.credits;
            if course.passed {
                p.approved_credits += course.credits;
            }
        }
        p.courses.push(course);
    };
    for c in COURSE.captures_iter(txt) {
        let grade = parse_f(&c[6]);
        add(TakenCourse {
            name: c[1].trim().to_owned(),
            code: c[2].trim().to_owned(),
            credits: c[3].parse().unwrap_or(0),
            typology: Typology::parse(&c[4]),
            typology_label: c[4].trim().to_owned(),
            period: c[5].to_owned(),
            grade,
            passed: grade.is_some_and(|g| g >= 3.0),
        });
    }
    for c in COURSE_NO_GRADE.captures_iter(txt) {
        add(TakenCourse {
            name: c[1].trim().to_owned(),
            code: c[2].trim().to_owned(),
            credits: c[3].parse().unwrap_or(0),
            typology: Typology::parse(&c[4]),
            typology_label: c[4].trim().to_owned(),
            period: c[5].to_owned(),
            grade: None,
            passed: &c[6] == "APROBADA",
        });
    }

    let mut periods: Vec<Period> = periods.into_values().collect();
    let mut accumulated = 0.0;
    for i in 0..periods.len() {
        periods[i].papi = papi(&periods[i]);
        periods[i].papa = papa(&periods[..=i]);
        periods[i].pa = pa(&periods[..=i]);
        let progress = if total_required == 0 {
            0.0
        } else {
            (periods[i].approved_credits as f64 / total_required as f64 * 100.0).max(0.0)
        };
        accumulated += progress;
        periods[i].progress = round(progress, 1);
        periods[i].accumulated_progress = round(accumulated, 1);
    }

    let all: Vec<&TakenCourse> = periods.iter().flat_map(|p| &p.courses).collect();
    let graded: Vec<f64> = all.iter().filter_map(|c| c.grade).collect();
    let highest = graded.iter().copied().fold(0.0, f64::max);
    let lowest = if empty {
        0.0
    } else {
        graded.iter().copied().fold(6.0, f64::min)
    };
    let eq = |a: f64, b: f64| (a - b).abs() < 1e-9;

    Ok(AcademicHistory {
        username: first(&USERNAME, txt, 1).map(str::to_owned),
        plan,
        faculty: need(&FACULTY, "la facultad")?,
        status: first(&STATUS, txt, 1)
            .map(|s| s.split_whitespace().next().unwrap_or("").to_owned())
            .unwrap_or_default(),
        papa: if empty {
            None
        } else {
            first(&PAPA, txt, 1).and_then(parse_f)
        },
        pa: if empty {
            None
        } else {
            first(&PA, txt, 1).and_then(parse_f)
        },
        progress: first(&PROGRESS, txt, 1).and_then(parse_f).unwrap_or(0.0),
        progress_fundamental: pct(fo.approved + fp.approved, fo.required + fp.required),
        progress_disciplinary: pct(dobl.approved + dopt.approved, dobl.required + dopt.required),
        progress_electives: cr("LIBRE ELECCIÓN").progress,
        credits,
        surplus_credits: first(&SURPLUS, txt, 1)
            .and_then(|s| s.parse().ok())
            .unwrap_or(0),
        cancelled_credits: first(&CANCELLED, txt, 1)
            .and_then(|s| s.parse().ok())
            .unwrap_or(0),
        quota: CreditQuota {
            additional: first(&ADDITIONAL, txt, 1)
                .and_then(|s| s.parse().ok())
                .unwrap_or(0),
            quota: first(&QUOTA, txt, 1)
                .and_then(|s| s.parse().ok())
                .unwrap_or(0),
            available: first(&AVAILABLE, txt, 1)
                .and_then(|s| s.parse().ok())
                .unwrap_or(0),
            double_degree: first(&DOUBLE_DEGREE, txt, 1)
                .and_then(|s| s.parse().ok())
                .unwrap_or(0),
        },
        average_progress: if periods.is_empty() {
            0.0
        } else {
            round(accumulated / periods.len() as f64, 2)
        },
        courses_seen: unique_best(&all).len() as u32,
        highest_grade: highest,
        highest_grade_count: graded.iter().filter(|g| eq(**g, highest)).count() as u32,
        lowest_grade: lowest,
        lowest_grade_count: graded.iter().filter(|g| eq(**g, lowest)).count() as u32,
        periods,
    })
}

/// Best attempt per course code (highest grade wins).
fn unique_best<'a>(courses: &[&'a TakenCourse]) -> Vec<&'a TakenCourse> {
    let mut best: HashMap<&str, &TakenCourse> = HashMap::new();
    let mut order = Vec::new();
    for c in courses {
        match best.get(c.code.as_str()) {
            None => {
                order.push(c.code.as_str());
                best.insert(&c.code, c);
            }
            Some(prev) if prev.grade.unwrap_or(0.0) < c.grade.unwrap_or(0.0) => {
                best.insert(&c.code, c);
            }
            _ => {}
        }
    }
    order.into_iter().map(|k| best[k]).collect()
}

/// Period average: graded credits only.
pub fn papi(p: &Period) -> Option<f64> {
    let credits = (p.credits + p.leveling_credits).saturating_sub(p.ungraded_credits);
    let sum: f64 = p
        .courses
        .iter()
        .filter_map(|c| c.grade.map(|g| g * c.credits as f64))
        .sum();
    (credits > 0).then(|| round(sum / credits as f64, 2))
}

/// P.A.P.A.: every attempt counts.
pub fn papa(periods: &[Period]) -> Option<f64> {
    let mut sum = 0.0;
    let mut credits = 0i64;
    for p in periods {
        for c in &p.courses {
            if let Some(g) = c.grade {
                sum += g * c.credits as f64;
            }
            credits += c.credits as i64;
        }
        credits -= p.ungraded_credits as i64;
    }
    (credits > 0).then(|| round(sum / credits as f64, 2))
}

/// P.A.: best passed attempt per course.
pub fn pa(periods: &[Period]) -> Option<f64> {
    let all: Vec<&TakenCourse> = periods.iter().flat_map(|p| &p.courses).collect();
    let (mut sum, mut credits) = (0.0, 0u32);
    for c in unique_best(&all) {
        if let Some(g) = c.grade.filter(|g| *g >= 3.0) {
            sum += g * c.credits as f64;
            credits += c.credits;
        }
    }
    (credits > 0).then(|| round(sum / credits as f64, 2))
}

/// Codes of every course that appears in the history, passed or not.
pub fn taken_codes(h: &AcademicHistory) -> Vec<String> {
    h.periods
        .iter()
        .flat_map(|p| p.courses.iter().map(|c| c.code.clone()))
        .collect()
}

pub fn passed_codes(h: &AcademicHistory) -> Vec<String> {
    h.periods
        .iter()
        .flat_map(|p| {
            p.courses
                .iter()
                .filter(|c| c.passed)
                .map(|c| c.code.clone())
        })
        .collect()
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Projection {
    pub current_papa: f64,
    pub approved_credits: u32,
    pub value: f64,
    /// False when the target cannot be reached with grades between 0 and 5.
    pub reachable: bool,
}

fn base(h: &AcademicHistory) -> Result<(f64, u32)> {
    let p = papa(&h.periods).ok_or_else(|| {
        Error::Invalid("La historia no tiene notas para calcular el P.A.P.A.".into())
    })?;
    let approved = h.credits.get("TOTAL").map(|c| c.approved).unwrap_or(0);
    Ok((p, approved))
}

/// PAPA after a period with average `papi` over `credits` credits.
pub fn papa_after(h: &AcademicHistory, papi: f64, credits: u32) -> Result<Projection> {
    let (p, a) = base(h)?;
    let value = round(
        (p * a as f64 + papi * credits as f64) / (credits + a).max(1) as f64,
        2,
    );
    Ok(Projection {
        current_papa: p,
        approved_credits: a,
        value,
        reachable: true,
    })
}

/// PAPI needed in the next `credits` credits to reach `target` PAPA.
pub fn papi_for(h: &AcademicHistory, target: f64, credits: u32) -> Result<Projection> {
    if credits == 0 {
        return Err(Error::Invalid(
            "Indica cuántos créditos vas a inscribir.".into(),
        ));
    }
    let (p, a) = base(h)?;
    let value = round(
        (target * (a + credits) as f64 - p * a as f64) / credits as f64,
        2,
    );
    Ok(Projection {
        current_papa: p,
        approved_credits: a,
        value,
        reachable: (0.0..=5.0).contains(&value),
    })
}

/// Highest PAPA possible if every pending credit is graded 5.0.
pub fn max_papa(h: &AcademicHistory) -> Result<Projection> {
    let pending = h.credits.get("TOTAL").map(|c| c.pending).unwrap_or(0);
    papa_after(h, 5.0, pending)
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = "abc123\nDatos personales\nPlan de estudios\n2879 INGENIERÍA DE SISTEMAS Y COMPUTACIÓN\nFacultad: FACULTAD DE INGENIERÍA\nHist. Acad.: 1ACTIVA\n4.1 (Acumulado)\nPAPA - P.A.P.A\n4.3 (Acumulado)\nPA - Promedio académico\nCálculo diferencial (1000004-B)\t4\tFUND. OBLIGATORIA\t2023-1S Ordinaria\t2.5\nCálculo diferencial (1000004-B)\t4\tFUND. OBLIGATORIA\t2023-2S Ordinaria\t4.0\nProgramación de computadores (2015734)\t3\tFUND. OBLIGATORIA\t2023-1S Ordinaria\t4.6\nCátedra de inducción (1000089-B)\t1\tLIBRE ELECCIÓN\t2023-1S Ordinaria\t\nAPROBADA\nFUND. OBLIGATORIA\t27\t7\t20\t0\t11\nFUND. OPTATIVA\t10\t0\t10\t0\t0\nDISCIPLINAR OBLIGATORIA\t60\t0\t60\t0\t0\nDISCIPLINAR OPTATIVA\t20\t0\t20\t0\t0\nLIBRE ELECCIÓN\t30\t1\t29\t0\t1\nTRABAJO DE GRADO\t6\t0\t6\t0\t0\nNIVELACIÓN\t4\t0\t4\t0\t0\nTOTAL\t153\t8\t145\t0\t12\nTOTAL ESTUDIANTE\t157\t8\t149\t0\t12\nTotal Créditos Excedentes0\nTotal de Créditos Cancelados en los Periodos Cursado0\nPorcentaje de Avance5,2%\nCréditos adicionales0\nCupo de créditos20\nCréditos disponibles12\n";

    #[test]
    fn parses_history() {
        validate(SAMPLE).unwrap();
        let h = parse(SAMPLE).unwrap();
        assert_eq!(h.username.as_deref(), Some("abc123"));
        assert_eq!(h.plan, "2879 INGENIERÍA DE SISTEMAS Y COMPUTACIÓN");
        assert_eq!(h.faculty, "FACULTAD DE INGENIERÍA");
        assert_eq!(h.papa, Some(4.1));
        assert_eq!(h.credits["TOTAL"].required, 153);
        assert_eq!(h.periods.len(), 2);
        assert_eq!(h.periods[0].name, "2023-1");
        assert_eq!(h.periods[0].courses.len(), 3);
        assert_eq!(h.courses_seen, 3);
        assert_eq!(h.highest_grade, 4.6);
        assert_eq!(h.lowest_grade, 2.5);
        assert_eq!(h.quota.quota, 20);
        assert!((h.progress - 5.2).abs() < 1e-9);
        // 2023-1: (2.5*4 + 4.6*3) / 7 = 3.4
        assert_eq!(h.periods[0].papi, Some(3.4));
        // PA uses the best attempt of Cálculo (4.0): (4*4 + 4.6*3) / 7 = 4.26
        assert_eq!(h.periods[1].pa, Some(4.26));
    }

    #[test]
    fn calculators() {
        let h = parse(SAMPLE).unwrap();
        let p = papi_for(&h, 4.5, 20).unwrap();
        assert!(p.reachable);
        let unreachable = papi_for(&h, 5.0, 1).unwrap();
        assert!(!unreachable.reachable);
        assert!(max_papa(&h).unwrap().value <= 5.0);
    }

    #[test]
    fn rejects_garbage() {
        assert!(matches!(validate("hola"), Err(Error::Invalid(_))));
    }
}

#[cfg(test)]
mod fixture_tests {
    #[test]
    fn parses_multi_period_fixture() {
        let txt = std::fs::read_to_string(format!(
            "{}/tests/fixtures/history_sample.txt",
            env!("CARGO_MANIFEST_DIR")
        ))
        .unwrap();
        let h = super::parse(&txt).unwrap();
        assert_eq!(h.periods.len(), 4);
        assert_eq!(h.periods.last().unwrap().name, "2024-2");
        assert_eq!(h.credits["TOTAL"].approved, 63);
        // Cálculo integral was failed (2.4) and then passed (3.6): PA keeps the best attempt.
        assert!(h.pa.unwrap() > 0.0 && h.periods[2].pa.unwrap() >= h.periods[2].papa.unwrap());
        assert_eq!(h.username.as_deref(), Some("usuario01"));
    }
}
