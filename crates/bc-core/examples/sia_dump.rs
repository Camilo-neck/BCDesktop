//! Save the raw page of a course: `cargo run -p bc-core --example sia_dump -- 0-2-8-4 2016696 out.html`.
use bc_core::model::CareerRef;
use bc_core::sia::SiaSession;
use std::time::Duration;

#[tokio::main]
async fn main() -> bc_core::Result<()> {
    let args: Vec<String> = std::env::args().collect();
    let career = CareerRef::from_search_code(&args[1], false).expect("search code");
    let mut s = SiaSession::open(Duration::from_secs(25)).await?;
    let listing = s.set_career(&career).await?.clone();
    println!("career name: {:?}", listing.career.name);
    let summary = listing
        .courses
        .iter()
        .find(|c| c.code == args[2])
        .expect("course in listing")
        .clone();
    println!("{summary:?}");
    let html = s.course_page(&summary).await?;
    std::fs::write(&args[3], html)?;
    Ok(())
}
