//! Professor ratings from LosEstudiantes (public GraphQL API).

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::error::{Error, Result};
use crate::text::normalize;

const URL: &str = "https://api.losestudiantes.com/graphql";
const UNAL_ID: u32 = 2;
const UNAL_SLUG: &str = "universidad-nacional";

const SEARCH: &str = "query searchWithinUniversity($id_university: Int!, $search: String!) { results: searchWithinUniversity(id_university: $id_university, search: $search) { options { ... on Professor { slug firstname lastname } } } }";
const PROFESSOR: &str = "query getProfessor($slug_university: String!, $slug: String!) { professor: getProfessor(slug_university: $slug_university, slug: $slug) { slug firstname lastname review_count overall_rating_avg grade_avg approval_ratio departments { name acronym } } }";

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Professor {
    pub name: String,
    pub url: String,
    pub rating: Option<f64>,
    pub grade_average: Option<f64>,
    pub approval_ratio: Option<f64>,
    pub reviews: u32,
    pub departments: Vec<String>,
}

async fn query(http: &reqwest::Client, name: &str, q: &str, vars: Value) -> Result<Value> {
    let body = json!({ "operationName": name, "query": q, "variables": vars });
    let v: Value = http
        .post(URL)
        .json(&body)
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;
    Ok(v)
}

/// Token overlap between the SIA name and a candidate, so "Juan Pérez." matches
/// "JUAN CARLOS PEREZ" better than another Juan.
fn similarity(a: &str, b: &str) -> usize {
    let tokens = |s: &str| {
        normalize(s)
            .split(' ')
            .filter(|t| t.len() > 1)
            .map(str::to_owned)
            .collect::<Vec<_>>()
    };
    let (ta, tb) = (tokens(a), tokens(b));
    ta.iter().filter(|t| tb.contains(t)).count()
}

pub async fn find(http: &reqwest::Client, professor: &str) -> Result<Option<Professor>> {
    let clean = professor.replace('.', " ");
    let clean = clean.trim();
    if clean.is_empty() || normalize(clean) == "NO INFORMADO" {
        return Ok(None);
    }
    let res = query(
        http,
        "searchWithinUniversity",
        SEARCH,
        json!({ "id_university": UNAL_ID, "search": clean }),
    )
    .await?;
    let mut best: Option<(usize, String)> = None;
    for group in res
        .pointer("/data/results")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        for opt in group
            .get("options")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
        {
            let Some(slug) = opt.get("slug").and_then(Value::as_str) else {
                continue;
            };
            let full = format!(
                "{} {}",
                opt.get("firstname").and_then(Value::as_str).unwrap_or(""),
                opt.get("lastname").and_then(Value::as_str).unwrap_or("")
            );
            let score = similarity(clean, &full);
            if score > 0 && best.as_ref().is_none_or(|(s, _)| score > *s) {
                best = Some((score, slug.to_owned()));
            }
        }
    }
    let Some((_, slug)) = best else {
        return Ok(None);
    };

    let res = query(
        http,
        "getProfessor",
        PROFESSOR,
        json!({ "slug_university": UNAL_SLUG, "slug": slug }),
    )
    .await?;
    let p = res
        .pointer("/data/professor")
        .ok_or_else(|| Error::External("LosEstudiantes no devolvió el profesor".into()))?;
    let f = |k: &str| p.get(k).and_then(Value::as_f64);
    Ok(Some(Professor {
        name: format!(
            "{} {}",
            p.get("firstname").and_then(Value::as_str).unwrap_or(""),
            p.get("lastname").and_then(Value::as_str).unwrap_or("")
        )
        .trim()
        .to_owned(),
        url: format!("https://losestudiantes.com/{UNAL_SLUG}/professors/{slug}"),
        rating: f("overall_rating_avg"),
        grade_average: f("grade_avg"),
        approval_ratio: f("approval_ratio"),
        reviews: p.get("review_count").and_then(Value::as_u64).unwrap_or(0) as u32,
        departments: p
            .get("departments")
            .and_then(Value::as_array)
            .map(|d| {
                d.iter()
                    .filter_map(|x| x.get("name").and_then(Value::as_str).map(str::to_owned))
                    .collect()
            })
            .unwrap_or_default(),
    }))
}

#[cfg(test)]
mod tests {
    #[test]
    fn similarity_prefers_more_tokens() {
        assert!(
            super::similarity("Juan Carlos Pérez.", "JUAN CARLOS PEREZ")
                > super::similarity("Juan Carlos Pérez.", "Juan Gómez")
        );
    }
}
