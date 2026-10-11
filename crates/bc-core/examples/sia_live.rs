//! Manual smoke test against the real SIA: `cargo run -p bc-core --example sia_live`.

use std::time::{Duration, Instant};

use bc_core::model::CareerRef;
use bc_core::sia::{Cancel, SiaService};

#[tokio::main]
async fn main() -> bc_core::Result<()> {
    let sia = SiaService::new(Duration::from_secs(25));
    let t = Instant::now();
    let levels = sia.levels().await?;
    println!(
        "levels {:?} ({:?})",
        levels.iter().map(|l| &l.label).collect::<Vec<_>>(),
        t.elapsed()
    );
    let campuses = sia.campuses("0").await?;
    println!("campuses {} ({:?})", campuses.len(), t.elapsed());
    let faculties = sia.faculties("0", "2").await?;
    println!(
        "faculties {:?}",
        faculties.iter().map(|f| &f.label).collect::<Vec<_>>()
    );
    let plans = sia.plans("0", "2", "8").await?;
    let plan = plans
        .iter()
        .find(|p| p.label.contains("2879"))
        .expect("plan 2879");
    println!("plan {} = {} ({:?})", plan.value, plan.label, t.elapsed());

    let career = CareerRef {
        level: "0".into(),
        campus: "2".into(),
        faculty: "8".into(),
        plan: plan.value.clone(),
        name: String::new(),
        electives: false,
    };
    let listing = sia.list_courses(&career).await?;
    println!(
        "{}: {} courses, {} rows ({:?})",
        listing.career.name,
        listing.courses.len(),
        listing.rows,
        t.elapsed()
    );
    let codes: Vec<String> = listing
        .courses
        .iter()
        .take(3)
        .chain(listing.courses.iter().skip(10).take(1))
        .map(|c| c.code.clone())
        .collect();
    let results = sia
        .fetch_courses(&career, &codes, &Cancel::default(), |p| {
            println!("  progress {}/{} {}", p.done, p.total, p.current)
        })
        .await?;
    for (code, r) in results {
        match r {
            Ok(c) => println!(
                "  {code}: {} · {} grupos · {} cupos",
                c.name,
                c.groups.len(),
                c.available_spots()
            ),
            Err(e) => println!("  {code}: ERROR {e}"),
        }
    }
    println!("done in {:?}", t.elapsed());
    Ok(())
}
