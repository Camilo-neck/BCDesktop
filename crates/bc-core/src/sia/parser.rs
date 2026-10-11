//! Pure parsers for SIA pages. They take HTML (or an ADF partial response) and
//! return domain types, so they can be tested against saved pages.

use std::sync::LazyLock;

use chrono::{DateTime, NaiveDate, Utc};
use regex::Regex;
use scraper::{ElementRef, Html, Selector};
use serde::{Deserialize, Serialize};

use crate::error::{Error, Result};
use crate::model::{
    Condition, Course, CoursePrereqs, CourseSource, CourseSummary, Day, Group, PrereqRef, Session,
    Typology,
};
use crate::text::{code_in_parens, collapse_ws, parse_hhmm, strip_code};

fn sel(s: &str) -> Selector {
    Selector::parse(s).expect("static selector")
}

macro_rules! selector {
    ($name:ident, $css:expr) => {
        static $name: LazyLock<Selector> = LazyLock::new(|| sel($css));
    };
}

selector!(H2, "h2");
selector!(CREDITS, "span.detass-creditos");
selector!(TYPOLOGY, "span.detass-tipologia");
selector!(SECTIONS, "span.borde.salto");
selector!(GROUP_TITLE, "h2.af_showDetailHeader_title-text0");
selector!(FIELD_ROWS, "div.margin-t > div");
selector!(STRONG, "span.strong");
selector!(LIST_ITEM, "span.lista-elemento");
selector!(TABLE_ROW, "tr.af_table_data-row");
selector!(CELL, "span.af_column_data-container");
selector!(OPTION, "option");
selector!(PREREQ_HEADER, "span.strong.af_panelGroupLayout");
selector!(PREREQ_COURSE, "span.margin-l.af_panelGroupLayout");

static CDATA: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?s)<!\[CDATA\[(.*?)\]\]>").unwrap());
static SESSION_LINE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^\s*([A-Za-zÁÉÍÓÚáéíóú]+)\s+de\s+(\d{1,2}:\d{2})\s+a\s+(\d{1,2}:\d{2})").unwrap()
});
static DATE_RANGE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"Fecha:\s*(\d{2}/\d{2}/\d{4})\s*-\s*(\d{2}/\d{2}/\d{4})").unwrap()
});
static FIRST_NUMBER: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\d+").unwrap());

/// ADF answers partial requests with XML whose `<update>` nodes carry HTML in CDATA.
/// Returns the concatenated HTML, or the input unchanged when it is already HTML.
pub fn html_of(response: &str) -> String {
    if !response.trim_start().starts_with("<?xml") && !response.contains("<partial-response") {
        return response.to_owned();
    }
    let mut out = String::with_capacity(response.len());
    for cap in CDATA.captures_iter(response) {
        out.push_str(&cap[1]);
        out.push('\n');
    }
    out
}

fn text_of(el: ElementRef) -> String {
    collapse_ws(&el.text().collect::<String>())
}

fn child_elements(el: ElementRef) -> impl Iterator<Item = ElementRef> {
    el.children().filter_map(ElementRef::wrap)
}

/// Hidden form state needed by every POST.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FormState {
    pub view_state: String,
    pub window_id: String,
}

pub fn parse_form_state(html: &str) -> Result<FormState> {
    let doc = Html::parse_document(html);
    let input = |name: &str| -> Option<String> {
        let s = sel(&format!(r#"input[name="{name}"]"#));
        doc.select(&s)
            .next()
            .and_then(|e| e.value().attr("value"))
            .map(str::to_owned)
    };
    Ok(FormState {
        view_state: input("javax.faces.ViewState")
            .ok_or_else(|| Error::layout("falta javax.faces.ViewState"))?,
        window_id: input("Adf-Window-Id").unwrap_or_else(|| "winnoloop".into()),
    })
}

/// Fast path used after every navigation: the view state is the only thing that changes.
pub fn find_view_state(html: &str) -> Option<String> {
    static VS: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(r#"name="javax\.faces\.ViewState"\s+value="([^"]*)""#).unwrap()
    });
    VS.captures(html).map(|c| c[1].to_owned())
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DropdownOption {
    pub value: String,
    pub label: String,
}

/// Options of the dropdown whose component id is `id` (without `::content`).
pub fn parse_dropdown(html: &str, id: &str) -> Vec<DropdownOption> {
    let doc = Html::parse_fragment(html);
    let select = sel(&format!(r#"select[id="{id}::content"]"#));
    let Some(el) = doc.select(&select).next() else {
        return Vec::new();
    };
    el.select(&OPTION)
        .filter_map(|o| {
            let value = o.value().attr("value")?.trim().to_owned();
            let label = text_of(o);
            (!value.is_empty() && !label.is_empty()).then_some(DropdownOption { value, label })
        })
        .collect()
}

/// Rows of the results table after pressing "Mostrar". Keeps the original row
/// position (needed to open a course) and drops unscheduled or repeated courses.
pub fn parse_course_list(html: &str) -> Vec<CourseSummary> {
    let doc = Html::parse_fragment(html);
    let mut seen = std::collections::HashSet::new();
    let mut out = Vec::new();
    for (row, tr) in doc.select(&TABLE_ROW).enumerate() {
        let cells: Vec<String> = tr.select(&CELL).map(text_of).collect();
        let (Some(code), Some(name)) = (cells.first(), cells.get(1)) else {
            continue;
        };
        if code.is_empty()
            || name.to_uppercase().contains("ASIGNATURA SIN PROGRAMAR")
            || !seen.insert(code.clone())
        {
            continue;
        }
        out.push(CourseSummary {
            code: code.clone(),
            name: name.clone(),
            credits: cells.get(2).and_then(|c| c.trim().parse().ok()),
            typology: cells
                .get(3)
                .map(|t| Typology::parse(t))
                .unwrap_or(Typology::Other),
            row,
        });
    }
    out
}

/// Total number of rows in the results table (including skipped ones).
pub fn count_rows(html: &str) -> usize {
    Html::parse_fragment(html).select(&TABLE_ROW).count()
}

struct CourseHeader {
    code: String,
    name: String,
    credits: u8,
    typology: Typology,
}

fn parse_header(doc: &Html) -> Result<CourseHeader> {
    let title = doc
        .select(&H2)
        .next()
        .map(text_of)
        .ok_or_else(|| Error::layout("la página del curso no tiene título"))?;
    let code = code_in_parens(&title)
        .ok_or_else(|| Error::layout(format!("título sin código: {title}")))?
        .to_owned();
    let after_colon = |s: String| {
        s.split_once(':')
            .map(|(_, v)| v.trim().to_owned())
            .unwrap_or(s)
    };
    let credits = doc
        .select(&CREDITS)
        .next()
        .map(|e| after_colon(text_of(e)))
        .and_then(|c| FIRST_NUMBER.find(&c).and_then(|m| m.as_str().parse().ok()))
        .unwrap_or(0);
    let typology = doc
        .select(&TYPOLOGY)
        .next()
        .map(|e| Typology::parse(&after_colon(text_of(e))))
        .unwrap_or(Typology::Other);
    Ok(CourseHeader {
        name: strip_code(&title).to_owned(),
        code,
        credits,
        typology,
    })
}

/// Code shown in the title of a course page; used to verify we opened the right row.
pub fn course_code_of_page(html: &str) -> Option<String> {
    let doc = Html::parse_fragment(html);
    let title = doc.select(&H2).next().map(text_of)?;
    code_in_parens(&title).map(str::to_owned)
}

fn parse_date(s: &str) -> Option<NaiveDate> {
    NaiveDate::parse_from_str(s, "%d/%m/%Y").ok()
}

fn parse_group(section: ElementRef, label: String) -> Group {
    let id = code_in_parens(&format!("{})", label.split(')').next().unwrap_or("")))
        .map(str::to_owned)
        .unwrap_or_else(|| label.clone());
    let mut group = Group {
        id,
        label,
        professors: Vec::new(),
        faculty: String::new(),
        sessions: Vec::new(),
        duration: String::new(),
        shift: String::new(),
        spots: None,
        starts_on: None,
        ends_on: None,
    };

    for row in section.select(&FIELD_ROWS) {
        let text = text_of(row);
        let value = || {
            text.split_once(':')
                .map(|(_, v)| v.trim().to_owned())
                .unwrap_or_default()
        };
        if text.starts_with("Profesor") {
            group.professors = row
                .select(&STRONG)
                .map(|e| text_of(e).trim_end_matches('.').trim().to_owned())
                .filter(|p| !p.is_empty())
                .collect();
            if group.professors.is_empty() {
                let v = value();
                if !v.is_empty() && !v.eq_ignore_ascii_case("No informado") {
                    group.professors.push(v.trim_end_matches('.').to_owned());
                }
            }
        } else if text.starts_with("Facultad") {
            group.faculty = value();
        } else if text.starts_with("Horarios") {
            for item in row.select(&LIST_ITEM) {
                let mut kids = child_elements(item);
                let Some(first) = kids.next() else { continue };
                let line = text_of(first);
                let Some(cap) = SESSION_LINE.captures(&line) else {
                    continue;
                };
                let (Some(day), Some(start), Some(end)) = (
                    Day::from_spanish(&cap[1]),
                    parse_hhmm(&cap[2]),
                    parse_hhmm(&cap[3]),
                ) else {
                    continue;
                };
                let room = kids.next().map(text_of).unwrap_or_default();
                group.sessions.push(Session {
                    day,
                    start,
                    end,
                    room,
                });
            }
            for cap in DATE_RANGE.captures_iter(&text) {
                if let (Some(a), Some(b)) = (parse_date(&cap[1]), parse_date(&cap[2])) {
                    group.starts_on = Some(group.starts_on.map_or(a, |d| d.min(a)));
                    group.ends_on = Some(group.ends_on.map_or(b, |d| d.max(b)));
                }
            }
        } else if text.starts_with("Duraci") {
            group.duration = value();
        } else if text.starts_with("Jornada") {
            group.shift = value();
        } else if text.starts_with("Cupos") {
            group.spots = FIRST_NUMBER
                .find(&value())
                .and_then(|m| m.as_str().parse().ok());
        }
    }
    group.sessions.sort_by_key(|s| (s.day, s.start));
    group
}

/// Full course page: header plus every group with its sessions.
pub fn parse_course_detail(html: &str, fetched_at: DateTime<Utc>) -> Result<Course> {
    let doc = Html::parse_fragment(html);
    let header = parse_header(&doc)?;
    let groups = doc
        .select(&SECTIONS)
        .filter(|s| !s.value().classes().any(|c| c == "ficha-docente"))
        .filter_map(|s| s.select(&GROUP_TITLE).next().map(|t| (s, text_of(t))))
        .map(|(s, label)| parse_group(s, label))
        .collect();
    Ok(Course {
        code: header.code,
        name: header.name,
        credits: header.credits,
        typology: header.typology,
        groups,
        fetched_at,
        source: CourseSource::Sia,
        career: None,
    })
}

/// Prerequisite conditions listed at the bottom of a course page.
pub fn parse_course_prereqs(html: &str) -> Result<CoursePrereqs> {
    let doc = Html::parse_fragment(html);
    let header = parse_header(&doc)?;
    let mut conditions = Vec::new();
    for section in doc.select(&SECTIONS) {
        if section.select(&GROUP_TITLE).next().is_some() {
            continue;
        }
        let Some(head) = section.select(&PREREQ_HEADER).next() else {
            continue;
        };
        let parts: Vec<String> = child_elements(head).map(text_of).collect();
        let field = |label: &str| -> Option<&str> {
            parts
                .iter()
                .position(|p| p.starts_with(label))
                .and_then(|i| parts.get(i + 1))
                .map(String::as_str)
        };
        let Some(number) = field("Condici").and_then(|n| n.parse().ok()) else {
            continue;
        };
        let courses = section
            .select(&PREREQ_COURSE)
            .filter_map(|c| {
                let kids: Vec<String> = child_elements(c).map(text_of).collect();
                match kids.as_slice() {
                    [code, name, ..] if !code.is_empty() => Some(PrereqRef {
                        code: code.clone(),
                        name: name.clone(),
                    }),
                    _ => None,
                }
            })
            .collect();
        conditions.push(Condition {
            number,
            kind: field("Tipo").unwrap_or("Y").trim().to_owned(),
            all: field("¿Todas").map(|v| v.contains('S')).unwrap_or(true),
            required: field("Número")
                .and_then(|v| FIRST_NUMBER.find(v))
                .and_then(|m| m.as_str().parse().ok()),
            courses,
        });
    }
    Ok(CoursePrereqs {
        code: header.code,
        name: header.name,
        credits: header.credits,
        typology: header.typology,
        conditions,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture(name: &str) -> String {
        std::fs::read_to_string(format!(
            "{}/tests/fixtures/{name}",
            env!("CARGO_MANIFEST_DIR")
        ))
        .unwrap()
    }

    #[test]
    fn reads_form_state() {
        let st = parse_form_state(&fixture("main_page.html")).unwrap();
        assert_eq!(st.view_state, "!-9jjhrb08s");
        assert_eq!(st.window_id, "winnoloop");
    }

    #[test]
    fn reads_dropdowns() {
        let levels = parse_dropdown(
            &fixture("main_page.html"),
            super::super::constants::ids::LEVEL,
        );
        assert_eq!(
            levels[0],
            DropdownOption {
                value: "0".into(),
                label: "Pregrado".into()
            }
        );
        let careers = parse_dropdown(
            &html_of(&fixture("careers.xml")),
            super::super::constants::ids::PLAN,
        );
        assert!(careers
            .iter()
            .any(|c| c.label == "2879 INGENIERÍA DE SISTEMAS Y COMPUTACIÓN"));
        let faculties = parse_dropdown(
            &html_of(&fixture("faculties.xml")),
            super::super::constants::ids::FACULTY,
        );
        assert_eq!(
            faculties.iter().find(|f| f.value == "8").unwrap().label,
            "2055 FACULTAD DE INGENIERÍA"
        );
    }

    #[test]
    fn reads_course_list() {
        let html = html_of(&fixture("course_list.xml"));
        let list = parse_course_list(&html);
        assert_eq!(count_rows(&html), 66);
        let first = &list[0];
        assert_eq!(first.code, "1000003-B");
        assert_eq!(first.name, "Álgebra Lineal");
        assert_eq!(first.credits, Some(4));
        assert_eq!(first.typology, Typology::FundObligatoria);
        assert_eq!(list.iter().find(|c| c.code == "1000009-B").unwrap().row, 3);
    }

    #[test]
    fn reads_course_detail() {
        let course =
            parse_course_detail(&html_of(&fixture("course_detail.xml")), Utc::now()).unwrap();
        assert_eq!(course.code, "1000009-B");
        assert_eq!(course.name, "Biología general");
        assert_eq!(course.credits, 3);
        assert_eq!(course.typology, Typology::FundObligatoria);
        assert_eq!(course.groups.len(), 9);
        let g1 = &course.groups[0];
        assert_eq!(g1.id, "1");
        assert_eq!(g1.label, "(1) Grupo 1 - BIOLOGIA");
        assert_eq!(g1.professors.len(), 3);
        assert_eq!(g1.professors[0], "Swanni Tatiana Alvarado Romero");
        assert_eq!(g1.faculty, "FACULTAD DE CIENCIAS");
        assert_eq!(g1.spots, Some(55));
        assert_eq!(g1.shift, "DIURNO");
        assert_eq!(g1.duration, "Semestral");
        assert_eq!(g1.starts_on, NaiveDate::from_ymd_opt(2026, 8, 24));
        assert_eq!(g1.sessions.len(), 2);
        assert_eq!(g1.sessions[0].day, Day::Tue);
        assert_eq!((g1.sessions[0].start, g1.sessions[0].end), (660, 780));
        assert!(g1.sessions[0]
            .room
            .starts_with("AUDITORIO LUIS EDUARDO MORA OSEJO"));
        assert_eq!(course.groups[1].id, "SUMA-02");
        assert!(course.available_spots() > 0);
    }

    #[test]
    fn reads_prereqs() {
        let p = parse_course_prereqs(&html_of(&fixture("course_prereqs.xml"))).unwrap();
        assert_eq!(p.code, "1000006-B");
        assert_eq!(p.credits, 4);
        assert_eq!(p.conditions.len(), 2);
        let c1 = &p.conditions[0];
        assert_eq!(
            (c1.number, c1.kind.as_str(), c1.all, c1.required),
            (1, "M", false, Some(1))
        );
        assert_eq!(
            c1.courses[0],
            PrereqRef {
                code: "1000005-B".into(),
                name: "Cálculo Integral".into()
            }
        );
        assert_eq!(c1.courses.len(), 2);
    }
}
