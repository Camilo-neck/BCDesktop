//! Print the parsed JSON of an academic history text: `cargo run -p bc-core --example parse_history -- file.txt`.
fn main() {
    let path = std::env::args().nth(1).expect("path to a history .txt");
    let txt = std::fs::read_to_string(path).expect("readable file");
    match bc_core::academic::parse(&txt) {
        Ok(h) => println!("{}", serde_json::to_string(&h).unwrap()),
        Err(e) => eprintln!("{e}"),
    }
}
