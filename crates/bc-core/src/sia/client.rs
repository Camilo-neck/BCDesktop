//! A conversation with the SIA catalog.
//!
//! The catalog is an Oracle ADF page: every click is a form POST that must carry
//! the current `javax.faces.ViewState`, and the server keeps the selected career
//! and table row in the session. [`SiaSession`] makes that state explicit
//! (`Fresh` → `OnCareer` → `OnCourse`) instead of the decorators and mutable
//! dictionaries of the Python version, and verifies that every course page it
//! opens is the course it asked for.

use std::time::{Duration, Instant};

use chrono::Utc;
use reqwest::header::{
    HeaderMap, HeaderValue, ACCEPT, ACCEPT_LANGUAGE, CONTENT_TYPE, ORIGIN, REFERER,
};

use super::constants::{self as c, ids};
use super::parser::{self, DropdownOption, FormState};
use crate::error::{Error, Result};
use crate::model::{CareerRef, Course, CoursePrereqs, CourseSummary};

/// Idle time after which the SIA forgets the ADF session.
const SESSION_TTL: Duration = Duration::from_secs(4 * 60);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Page {
    /// Search form, no career selected.
    Fresh,
    /// Results table of a career is showing.
    OnCareer,
    /// A course page is open.
    OnCourse,
}

/// The results of selecting a career.
#[derive(Debug, Clone)]
pub struct CareerListing {
    pub career: CareerRef,
    pub courses: Vec<CourseSummary>,
    /// Rows in the SIA table, including skipped ones; ADF needs it to select a row.
    pub rows: usize,
}

pub struct SiaSession {
    http: reqwest::Client,
    form: FormState,
    page: Page,
    listing: Option<CareerListing>,
    last_used: Instant,
    initial_html: String,
}

type Fields = Vec<(String, String)>;

impl SiaSession {
    pub async fn open(timeout: Duration) -> Result<SiaSession> {
        let http = reqwest::Client::builder()
            .cookie_store(true)
            .gzip(true)
            .timeout(timeout)
            .connect_timeout(Duration::from_secs(10))
            .user_agent(c::USER_AGENT)
            .build()?;
        let html = http
            .get(format!("{}?{}", c::BASE_URL, c::TASKFLOW_QUERY))
            .send()
            .await?
            .error_for_status()?
            .text()
            .await?;
        let form = parser::parse_form_state(&html)?;
        Ok(SiaSession {
            http,
            form,
            page: Page::Fresh,
            listing: None,
            last_used: Instant::now(),
            initial_html: html,
        })
    }

    pub fn is_stale(&self) -> bool {
        self.last_used.elapsed() > SESSION_TTL
    }

    pub fn listing(&self) -> Option<&CareerListing> {
        self.listing.as_ref()
    }

    pub fn current_career(&self) -> Option<&CareerRef> {
        self.listing.as_ref().map(|l| &l.career)
    }

    // ---------------------------------------------------------------- requests

    fn post_headers() -> HeaderMap {
        let mut h = HeaderMap::new();
        h.insert(ACCEPT, HeaderValue::from_static("*/*"));
        h.insert(
            ACCEPT_LANGUAGE,
            HeaderValue::from_static("es-419,es;q=0.9,en;q=0.8"),
        );
        h.insert("adf-ads-page-id", HeaderValue::from_static("1"));
        h.insert("adf-rich-message", HeaderValue::from_static("true"));
        h.insert(
            CONTENT_TYPE,
            HeaderValue::from_static("application/x-www-form-urlencoded; charset=UTF-8"),
        );
        h.insert(ORIGIN, HeaderValue::from_static("https://sia.unal.edu.co"));
        h.insert(REFERER, HeaderValue::from_static(c::BASE_URL));
        h
    }

    fn query(&self) -> [(&'static str, String); 2] {
        [
            ("Adf-Window-Id", self.form.window_id.clone()),
            ("Adf-Page-Id", c::PAGE_ID.into()),
        ]
    }

    async fn post(&mut self, fields: &Fields) -> Result<String> {
        let res = self
            .http
            .post(c::BASE_URL)
            .query(&self.query())
            .headers(Self::post_headers())
            .form(fields)
            .send()
            .await?
            .error_for_status()?;
        let body = res.text().await?;
        self.last_used = Instant::now();
        if body.contains(c::SESSION_TIMEOUT_MARKER) {
            return Err(Error::SiaState("la sesión expiró"));
        }
        Ok(body)
    }

    /// Load the search form again. ADF only re-renders a dropdown when its value
    /// changes, so selecting a career always starts from a clean form.
    async fn reset_form(&mut self) -> Result<()> {
        let html = self
            .http
            .get(format!("{}?{}", c::BASE_URL, c::TASKFLOW_QUERY))
            .send()
            .await?
            .error_for_status()?
            .text()
            .await?;
        self.last_used = Instant::now();
        self.form = parser::parse_form_state(&html)?;
        self.page = Page::Fresh;
        self.listing = None;
        Ok(())
    }

    async fn refresh_view_state(&mut self) -> Result<()> {
        let html = self
            .http
            .get(c::BASE_URL)
            .query(&self.query())
            .send()
            .await?
            .error_for_status()?
            .text()
            .await?;
        self.last_used = Instant::now();
        if let Some(vs) = parser::find_view_state(&html) {
            self.form.view_state = vs;
        }
        Ok(())
    }

    /// The fields every form POST carries. `values` = level, campus, faculty, plan.
    fn base_fields(&self, values: [&str; 4], typology: &str) -> Fields {
        let mut f: Fields = vec![
            (ids::LEVEL.into(), values[0].into()),
            (ids::CAMPUS.into(), values[1].into()),
            (ids::FACULTY.into(), values[2].into()),
            (ids::PLAN.into(), values[3].into()),
            (ids::TYPOLOGY.into(), typology.into()),
            (ids::SHOW_BUTTON.into(), String::new()),
            (ids::ELECTIVE_MODE.into(), String::new()),
            ("pt1:r1:0:soc10".into(), String::new()),
            ("pt1:r1:0:it10".into(), String::new()),
            ("pt1:r1:0:it11".into(), String::new()),
            ("org.apache.myfaces.trinidad.faces.FORM".into(), "f1".into()),
            ("Adf-Window-Id".into(), self.form.window_id.clone()),
            ("Adf-Page-Id".into(), c::PAGE_ID.into()),
            ("javax.faces.ViewState".into(), self.form.view_state.clone()),
        ];
        f.shrink_to_fit();
        f
    }

    fn set_field(fields: &mut Fields, key: &str, value: String) {
        match fields.iter_mut().find(|(k, _)| k == key) {
            Some(slot) => slot.1 = value,
            None => fields.push((key.into(), value)),
        }
    }

    fn with_event(mut fields: Fields, id: &str, value: &str, is_action: bool) -> Fields {
        fields.push(("event".into(), id.into()));
        fields.push((format!("event.{id}"), value.into()));
        let process = if is_action {
            format!("pt1:r1,{id}")
        } else {
            id.to_owned()
        };
        fields.push(("oracle.adf.view.rich.PROCESS".into(), process));
        fields
    }

    fn typology_for(&self) -> &'static str {
        match &self.listing {
            Some(l) if l.career.electives => c::ELECTIVES_TYPOLOGY,
            _ => "",
        }
    }

    // ------------------------------------------------------------ catalog tree

    pub fn levels(&self) -> Vec<DropdownOption> {
        parser::parse_dropdown(&self.initial_html, ids::LEVEL)
    }

    async fn dropdown_chain(
        &mut self,
        values: [&str; 4],
        depth: usize,
        target: &str,
    ) -> Result<Vec<DropdownOption>> {
        let order = [ids::LEVEL, ids::CAMPUS, ids::FACULTY];
        let mut html = String::new();
        for (i, id) in order.iter().enumerate().take(depth) {
            let mut v = values;
            for slot in v.iter_mut().skip(i + 1) {
                *slot = "";
            }
            let fields =
                Self::with_event(self.base_fields(v, ""), id, c::EVENT_VALUE_CHANGE, false);
            html = parser::html_of(&self.post(&fields).await?);
        }
        self.page = Page::Fresh;
        self.listing = None;
        Ok(parser::parse_dropdown(&html, target))
    }

    pub async fn campuses(&mut self, level: &str) -> Result<Vec<DropdownOption>> {
        let mut out = self
            .dropdown_chain([level, "", "", ""], 1, ids::CAMPUS)
            .await?;
        out.retain(|o| o.value != "0" || !o.label.is_empty());
        Ok(out)
    }

    pub async fn faculties(&mut self, level: &str, campus: &str) -> Result<Vec<DropdownOption>> {
        let mut out = self
            .dropdown_chain([level, campus, "", ""], 2, ids::FACULTY)
            .await?;
        out.retain(|o| !c::IGNORED_FACULTY_WORDS.iter().any(|w| o.label.contains(w)));
        Ok(out)
    }

    pub async fn plans(
        &mut self,
        level: &str,
        campus: &str,
        faculty: &str,
    ) -> Result<Vec<DropdownOption>> {
        self.dropdown_chain([level, campus, faculty, ""], 3, ids::PLAN)
            .await
    }

    // ------------------------------------------------------------------ career

    /// Select a career and press "Mostrar". Mirrors the request order the SIA expects.
    pub async fn set_career(&mut self, career: &CareerRef) -> Result<&CareerListing> {
        let mut name = career.name.clone();
        if name.is_empty() {
            let plans = self
                .plans(&career.level, &career.campus, &career.faculty)
                .await?;
            name = plans
                .into_iter()
                .find(|o| o.value == career.plan)
                .map(|o| o.label)
                .unwrap_or_default();
        }
        self.reset_form().await?;
        let values = [
            career.level.as_str(),
            career.campus.as_str(),
            career.faculty.as_str(),
            career.plan.as_str(),
        ];
        let typology = if career.electives {
            c::ELECTIVES_TYPOLOGY
        } else {
            ""
        };

        let mut steps: Vec<Fields> = [
            ids::LEVEL,
            ids::CAMPUS,
            ids::FACULTY,
            ids::PLAN,
            ids::TYPOLOGY,
        ]
        .iter()
        .map(|id| {
            Self::with_event(
                self.base_fields(values, typology),
                id,
                c::EVENT_VALUE_CHANGE,
                false,
            )
        })
        .collect();
        if career.electives {
            let mut base = self.base_fields(values, typology);
            Self::set_field(&mut base, ids::ELECTIVE_MODE, "0".into());
            steps.push(Self::with_event(
                base.clone(),
                ids::ELECTIVE_MODE,
                c::EVENT_VALUE_CHANGE,
                false,
            ));
            let campus: u32 = career
                .campus
                .parse()
                .map_err(|_| Error::Invalid("sede inválida".into()))?;
            Self::set_field(
                &mut base,
                ids::ELECTIVE_CAMPUS,
                (campus + c::ELECTIVES_CAMPUS_OFFSET).to_string(),
            );
            steps.push(Self::with_event(
                base.clone(),
                ids::ELECTIVE_CAMPUS,
                c::EVENT_VALUE_CHANGE,
                false,
            ));
            steps.push(Self::with_event(
                base,
                ids::SHOW_BUTTON,
                c::EVENT_ACTION,
                true,
            ));
        } else {
            steps.push(Self::with_event(
                self.base_fields(values, typology),
                ids::SHOW_BUTTON,
                c::EVENT_ACTION,
                true,
            ));
        }

        let mut last = String::new();
        for (i, fields) in steps.iter().enumerate() {
            last = parser::html_of(&self.post(fields).await?);
            if i >= 2 && name.is_empty() {
                name = parser::parse_dropdown(&last, ids::PLAN)
                    .into_iter()
                    .find(|o| o.value == career.plan)
                    .map(|o| o.label)
                    .unwrap_or_default();
            }
        }

        let courses = parser::parse_course_list(&last);
        let rows = parser::count_rows(&last);
        if rows == 0 {
            return Err(Error::NotFound(
                "El SIA no devolvió asignaturas para esa carrera.".into(),
            ));
        }
        self.listing = Some(CareerListing {
            career: CareerRef {
                name,
                ..career.clone()
            },
            courses,
            rows,
        });
        self.page = Page::OnCareer;

        // The SIA ignores the first row selection after "Mostrar"; opening and
        // closing row 0 once leaves the table in a state where any row can be opened.
        self.enter_row(0).await?;
        self.exit_course().await?;
        Ok(self.listing.as_ref().expect("listing just set"))
    }

    fn rows(&self) -> Result<usize> {
        self.listing
            .as_ref()
            .map(|l| l.rows)
            .ok_or(Error::SiaState("no hay carrera seleccionada"))
    }

    async fn select_row(&mut self, row: usize) -> Result<()> {
        let rows = self.rows()?;
        let id = format!("{}:{row}:cl2", ids::RESULTS_TABLE);
        let mut fields = Self::with_event(
            self.base_fields(["", "", "", ""], self.typology_for()),
            &id,
            c::EVENT_SELECTION,
            false,
        );
        fields.push((
            "oracle.adf.view.rich.DELTAS".into(),
            format!(
                "{{{}={{viewportSize={},rows={rows},selectedRowKeys={row}}}}}",
                ids::RESULTS_TABLE,
                rows + 1
            ),
        ));
        self.post(&fields).await?;
        Ok(())
    }

    async fn enter_row(&mut self, row: usize) -> Result<String> {
        if self.page != Page::OnCareer {
            return Err(Error::SiaState("se esperaba la tabla de resultados"));
        }
        self.refresh_view_state().await?;
        self.select_row(row).await?;
        let id = format!("{}:{row}:cl2", ids::RESULTS_TABLE);
        let mut fields = Self::with_event(
            self.base_fields(["", "", "", ""], self.typology_for()),
            &id,
            c::EVENT_ACTION,
            true,
        );
        fields.push(("oracle.adf.view.rich.RENDER".into(), "pt1:r1".into()));
        let html = parser::html_of(&self.post(&fields).await?);
        self.page = Page::OnCourse;
        Ok(html)
    }

    async fn exit_course(&mut self) -> Result<()> {
        if self.page != Page::OnCourse {
            return Err(Error::SiaState("no hay un curso abierto"));
        }
        // Field names copied verbatim from the request the SIA has always accepted.
        let fields: Fields = vec![
            ("org.apache.myfaces.trinidad.faces.FORM".into(), "f1".into()),
            ("Adf-Window-Idl".into(), self.form.window_id.clone()),
            ("Adf-Page-Id".into(), c::PAGE_ID.into()),
            ("javax.faces.ViewState".into(), self.form.view_state.clone()),
            ("event".into(), ids::BACK_BUTTON.into()),
            (
                format!("event.{}", ids::BACK_BUTTON),
                c::EVENT_ACTION.into(),
            ),
            (
                "oracle.adf.view.rich.PROCESS".into(),
                format!("pt1:r1,{}4", ids::BACK_BUTTON),
            ),
        ];
        self.post(&fields).await?;
        self.page = Page::OnCareer;
        self.select_row(1).await
    }

    /// Open the page of `course` and return its HTML, checking the title code.
    /// The ADF table swaps rows 0 and 1 after the first navigation, so when the
    /// page that opens is not the requested course, the neighbour row is tried.
    pub async fn course_page(&mut self, course: &CourseSummary) -> Result<String> {
        let mut candidates = vec![course.row];
        if course.row < 2 {
            candidates.insert(0, 1 - course.row);
        }
        for row in candidates {
            let html = self.enter_row(row).await?;
            let code = parser::course_code_of_page(&html);
            self.exit_course().await?;
            if code.as_deref() == Some(course.code.as_str()) {
                return Ok(html);
            }
            log::debug!("row {row} opened {code:?} instead of {}", course.code);
        }
        Err(Error::layout(format!(
            "no se pudo abrir {} en el SIA",
            course.code
        )))
    }

    pub async fn fetch_course(&mut self, course: &CourseSummary) -> Result<Course> {
        let html = self.course_page(course).await?;
        let mut parsed = parser::parse_course_detail(&html, Utc::now())?;
        parsed.career = self.current_career().cloned();
        Ok(parsed)
    }

    pub async fn fetch_prereqs(&mut self, course: &CourseSummary) -> Result<CoursePrereqs> {
        let html = self.course_page(course).await?;
        parser::parse_course_prereqs(&html)
    }
}
