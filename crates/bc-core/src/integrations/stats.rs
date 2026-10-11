//! Spot depletion history from the BetterCampus stats API. The history is
//! collected by a server-side job, so the desktop app only reads it.

use serde_json::{json, Value};

use crate::error::{Error, Result};

pub async fn inscription_stats(
    http: &reqwest::Client,
    base_url: &str,
    career_name: &str,
    course_code: &str,
) -> Result<Value> {
    let base = base_url.trim_end_matches('/');
    if base.is_empty() {
        return Err(Error::Invalid(
            "Configura la URL de la API de estadísticas en Ajustes.".into(),
        ));
    }
    let res = http
        .post(format!("{base}/InscriptionStats/"))
        .json(&json!({ "career_name": career_name, "course_code": course_code }))
        .send()
        .await?;
    match res.status().as_u16() {
        200 => Ok(res.json().await?),
        404 => Err(Error::NotFound(
            "No hay estadísticas de cupos para esta asignatura.".into(),
        )),
        s => Err(Error::External(format!(
            "La API de estadísticas respondió {s}"
        ))),
    }
}
