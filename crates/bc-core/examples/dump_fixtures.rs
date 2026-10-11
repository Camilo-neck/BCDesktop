//! Export real SIA data as JSON for the browser-only UI mock:
//! `cargo run -p bc-core --example dump_fixtures -- src/dev/fixtures`.
use std::time::Duration;

use bc_core::curriculum::{build, Options};
use bc_core::model::CareerRef;
use bc_core::sia::{Cancel, SiaService};
use serde_json::json;

#[tokio::main]
async fn main() -> bc_core::Result<()> {
    let out = std::env::args()
        .nth(1)
        .unwrap_or_else(|| "src/dev/fixtures".into());
    let sia = SiaService::new(Duration::from_secs(25));
    let levels = sia.levels().await?;
    let campuses = sia.campuses("0").await?;
    let faculties = sia.faculties("0", "2").await?;
    let plans = sia.plans("0", "2", "8").await?;
    let plan = plans
        .iter()
        .find(|p| p.label.contains("2879"))
        .expect("plan 2879")
        .clone();
    let career = CareerRef {
        level: "0".into(),
        campus: "2".into(),
        faculty: "8".into(),
        plan: plan.value.clone(),
        name: plan.label.clone(),
        electives: false,
    };
    let listing = sia.list_courses(&career).await?;

    let wanted = [
        "Cálculo diferencial",
        "Programación de computadores",
        "Álgebra Lineal",
        "Introducción a la ingeniería",
        "Biología general",
        "Matemáticas discretas",
        "Física",
        "Estructuras de datos",
        "Cálculo integral",
    ];
    let codes: Vec<String> = listing
        .courses
        .iter()
        .filter(|c| {
            wanted
                .iter()
                .any(|w| c.name.to_lowercase().starts_with(&w.to_lowercase()))
        })
        .chain(listing.courses.iter().take(30))
        .map(|c| c.code.clone())
        .collect::<std::collections::BTreeSet<_>>()
        .into_iter()
        .collect();
    let fetched = sia
        .fetch_courses(&career, &codes, &Cancel::default(), |p| {
            eprintln!("{}/{} {}", p.done, p.total, p.current)
        })
        .await?;
    let courses: Vec<_> = fetched
        .into_iter()
        .filter_map(|(_, r)| r.ok())
        .filter(|c| !c.groups.is_empty())
        .take(9)
        .collect();

    let prereqs = sia
        .fetch_all_prereqs(&career, 3, &Cancel::default(), |_| {})
        .await?;
    let graph = build(
        &prereqs,
        &[],
        &Options {
            hide_leveling: true,
            hide_external: false,
        },
    );

    let write = |name: &str, v: serde_json::Value| {
        std::fs::write(
            format!("{out}/{name}.json"),
            serde_json::to_string(&v).unwrap(),
        )
        .unwrap()
    };
    write(
        "catalog",
        json!({ "levels": levels, "campuses": campuses, "faculties": faculties, "plans": plans, "career": listing.career, "courses": listing.courses }),
    );
    write("courses", json!(courses));
    write("graph", json!(graph));
    eprintln!(
        "{} courses, {} graph nodes",
        courses.len(),
        graph.nodes.len()
    );
    Ok(())
}
