//! Scrape the prerequisites of a whole plan: `cargo run -p bc-core --example sia_prereqs -- 0-2-8-4`.
use bc_core::curriculum::{build, Options};
use bc_core::model::CareerRef;
use bc_core::sia::{Cancel, SiaService};
use std::time::{Duration, Instant};

#[tokio::main]
async fn main() -> bc_core::Result<()> {
    let code = std::env::args().nth(1).unwrap_or_else(|| "0-2-8-4".into());
    let career = CareerRef::from_search_code(&code, false).expect("search code");
    let sia = SiaService::new(Duration::from_secs(25));
    let t = Instant::now();
    let plan = sia
        .fetch_all_prereqs(&career, 3, &Cancel::default(), |p| {
            if p.done % 10 == 0 {
                println!("{}/{} {:?}", p.done, p.total, t.elapsed())
            }
        })
        .await?;
    let with_conditions = plan.iter().filter(|c| !c.conditions.is_empty()).count();
    let g = build(&plan, &[], &Options::default());
    println!(
        "{} courses ({} with prerequisites), {} edges, {} layers in {:?}",
        plan.len(),
        with_conditions,
        g.edges.len(),
        g.layers,
        t.elapsed()
    );
    Ok(())
}
