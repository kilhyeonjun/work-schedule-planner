use serde_json::{Value, json};
use std::io::{self, BufRead, Write};
fn main() -> io::Result<()> {
    let stdin = io::stdin();
    let mut stdout = io::BufWriter::new(io::stdout().lock());
    for line in stdin.lock().lines() {
        let line = line?;
        let response = match serde_json::from_str::<Value>(&line) {
            Ok(request) => match work_planner::dispatch(&request) {
                Ok(result) => json!({"ok":true,"result":result}),
                Err(error) => {
                    json!({"ok":false,"error":{"type":error.kind,"message":error.message}})
                }
            },
            Err(error) => {
                json!({"ok":false,"error":{"type":"ValueError","message":error.to_string()}})
            }
        };
        serde_json::to_writer(&mut stdout, &response)?;
        writeln!(stdout)?;
        stdout.flush()?;
    }
    Ok(())
}
