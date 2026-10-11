//! Identifiers of the Oracle ADF components in the public SIA catalog.
//! Every id lives here so a layout change in the SIA is a one-file fix.

pub const BASE_URL: &str =
    "https://sia.unal.edu.co/Catalogo/facespublico/public/servicioPublico.jsf";
pub const TASKFLOW_QUERY: &str = "taskflowId=task-flow-AC_CatalogoAsignaturas";
pub const PAGE_ID: &str = "0";

/// A browser user agent makes ADF answer with its JavaScript "loopback" page
/// instead of the form, so the client identifies itself honestly.
pub const USER_AGENT: &str = concat!("BetterCampus-Desktop/", env!("CARGO_PKG_VERSION"));

/// Dropdowns ("soc" = selectOneChoice) and buttons of the search form.
pub mod ids {
    pub const LEVEL: &str = "pt1:r1:0:soc1";
    pub const CAMPUS: &str = "pt1:r1:0:soc9";
    pub const FACULTY: &str = "pt1:r1:0:soc2";
    pub const PLAN: &str = "pt1:r1:0:soc3";
    pub const TYPOLOGY: &str = "pt1:r1:0:soc4";
    pub const SHOW_BUTTON: &str = "pt1:r1:0:cb1";
    /// Electives: "por facultad y plan" and the campus-as-faculty dropdown.
    pub const ELECTIVE_MODE: &str = "pt1:r1:0:soc5";
    pub const ELECTIVE_CAMPUS: &str = "pt1:r1:0:soc6";
    pub const RESULTS_TABLE: &str = "pt1:r1:0:t4";
    pub const BACK_BUTTON: &str = "pt1:r1:1:cb4";
}

/// Typology value that switches the form to "Libre elección" (electives).
pub const ELECTIVES_TYPOLOGY: &str = "7";
/// The electives campus dropdown lists campuses offset by this amount.
pub const ELECTIVES_CAMPUS_OFFSET: u32 = 40;

pub const EVENT_VALUE_CHANGE: &str = r#"<m xmlns="http://oracle.com/richClient/comm"><k v="autoSubmit"><b>1</b></k><k v="suppressMessageShow"><s>true</s></k><k v="type"><s>valueChange</s></k></m>"#;
pub const EVENT_ACTION: &str =
    r#"<m xmlns="http://oracle.com/richClient/comm"><k v="type"><s>action</s></k></m>"#;
pub const EVENT_SELECTION: &str =
    r#"<m xmlns="http://oracle.com/richClient/comm"><k v="type"><s>selection</s></k></m>"#;

/// Text the SIA renders when the ADF session expired.
pub const SESSION_TIMEOUT_MARKER: &str = "__getSessionTimeoutHelper().__alertTimeout()";

/// Faculties hidden from the catalog picker, as in the web version.
pub const IGNORED_FACULTY_WORDS: [&str; 1] = ["PAET"];
