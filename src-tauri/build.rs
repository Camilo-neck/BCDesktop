//! Local builds can take the `BC_*` build variables from a `.env` file at the repository
//! root (ignored by git; see `.env.example`). Variables already set in the environment,
//! as in CI, take precedence.

use std::path::Path;

const KEYS: &[&str] = &[
    "BC_GOOGLE_CLIENT_ID",
    "BC_GOOGLE_CLIENT_SECRET",
    "BC_STATS_API_URL",
];

fn main() {
    for key in KEYS {
        println!("cargo:rerun-if-env-changed={key}");
    }
    let dotenv = Path::new("../.env");
    // Only watch the file when it exists: a missing path would make Cargo rerun this script on every build.
    if let Ok(text) = std::fs::read_to_string(dotenv) {
        println!("cargo:rerun-if-changed={}", dotenv.display());
        for line in text.lines() {
            let Some((key, value)) = line.split_once('=') else {
                continue;
            };
            let (key, value) = (key.trim(), value.trim().trim_matches('"'));
            if KEYS.contains(&key) && !value.is_empty() && std::env::var_os(key).is_none() {
                println!("cargo:rustc-env={key}={value}");
            }
        }
    }
    tauri_build::build()
}
