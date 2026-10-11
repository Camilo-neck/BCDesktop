use serde::Serialize;

pub type Result<T, E = Error> = std::result::Result<T, E>;

/// Every failure the core can report. The `kind` tag is what the UI switches on;
/// the message is already written for the student.
#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("El SIA tardó demasiado en responder. Intenta de nuevo en unos segundos.")]
    Timeout,
    #[error("No hay conexión con {0}. Revisa tu red.")]
    Network(String),
    #[error("El SIA respondió algo inesperado: {0}")]
    SiaLayout(String),
    #[error("La sesión con el SIA no está en el estado correcto: {0}")]
    SiaState(&'static str),
    #[error("{0}")]
    NotFound(String),
    #[error("{0}")]
    Invalid(String),
    #[error("Error de almacenamiento local: {0}")]
    Storage(String),
    #[error("{0}")]
    Auth(String),
    #[error("Operación cancelada")]
    Cancelled,
    #[error("{0}")]
    External(String),
}

impl Error {
    pub fn kind(&self) -> &'static str {
        match self {
            Error::Timeout => "timeout",
            Error::Network(_) => "network",
            Error::SiaLayout(_) => "sia_layout",
            Error::SiaState(_) => "sia_state",
            Error::NotFound(_) => "not_found",
            Error::Invalid(_) => "invalid",
            Error::Storage(_) => "storage",
            Error::Auth(_) => "auth",
            Error::Cancelled => "cancelled",
            Error::External(_) => "external",
        }
    }

    pub fn layout(what: impl Into<String>) -> Self {
        Error::SiaLayout(what.into())
    }
}

impl From<reqwest::Error> for Error {
    fn from(e: reqwest::Error) -> Self {
        if e.is_timeout() {
            return Error::Timeout;
        }
        let host = e
            .url()
            .and_then(|u| u.host_str().map(str::to_owned))
            .unwrap_or_else(|| "el servidor".into());
        if e.is_connect() || e.is_request() {
            Error::Network(host)
        } else {
            Error::External(format!("{host}: {e}"))
        }
    }
}

impl From<rusqlite::Error> for Error {
    fn from(e: rusqlite::Error) -> Self {
        Error::Storage(e.to_string())
    }
}

impl From<serde_json::Error> for Error {
    fn from(e: serde_json::Error) -> Self {
        Error::Storage(format!("JSON: {e}"))
    }
}

impl From<std::io::Error> for Error {
    fn from(e: std::io::Error) -> Self {
        Error::Storage(e.to_string())
    }
}

/// Shape sent across the IPC boundary.
#[derive(Debug, Serialize)]
pub struct ErrorPayload {
    pub kind: &'static str,
    pub message: String,
}

impl From<&Error> for ErrorPayload {
    fn from(e: &Error) -> Self {
        ErrorPayload {
            kind: e.kind(),
            message: e.to_string(),
        }
    }
}

impl Serialize for Error {
    fn serialize<S: serde::Serializer>(&self, s: S) -> std::result::Result<S::Ok, S::Error> {
        ErrorPayload::from(self).serialize(s)
    }
}
