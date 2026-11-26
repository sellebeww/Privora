// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Vassel Goleyu
//! `corpus-gen gen [--out-dir DIR]` writes JSON Lines (dev and test splits).
//! `corpus-gen explain [--kind K]` lists misses and false alarms on the DEV split (tuning aid).
//! `corpus-gen eval [--dev-only] [--update FILE]` prints the accuracy tables (SINTETIS), optionally into a file
//! between the `EVAL:BEGIN` and `EVAL:END` markers. `corpus-gen eval --seed HEX` prints one other seed.

use std::fs;
use std::path::PathBuf;
use std::process::ExitCode;

use corpus_gen::docs::corpus;
use corpus_gen::eval::{evaluate, explain, markdown};
use corpus_gen::{DEV_SEED, DOCS_PER_SPLIT, TEST_SEED};

const BEGIN: &str = "<!-- EVAL:BEGIN -->";
const END: &str = "<!-- EVAL:END -->";

fn arg(args: &[String], flag: &str) -> Option<String> {
    args.iter()
        .position(|a| a == flag)
        .and_then(|i| args.get(i + 1))
        .cloned()
}

fn run(args: &[String]) -> Result<(), String> {
    match args.first().map(String::as_str) {
        Some("gen") => {
            let dir =
                PathBuf::from(arg(args, "--out-dir").unwrap_or_else(|| "target/corpus".into()));
            fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
            for (seed, split) in [(DEV_SEED, "dev"), (TEST_SEED, "test")] {
                let lines: Vec<String> = corpus(seed, split, DOCS_PER_SPLIT)
                    .iter()
                    .map(|d| d.to_json())
                    .collect();
                let path = dir.join(format!("{split}.jsonl"));
                fs::write(&path, lines.join("\n") + "\n").map_err(|e| e.to_string())?;
                println!(
                    "wrote {} ({} documents, seed {seed:#018x}, SINTETIS)",
                    path.display(),
                    lines.len()
                );
            }
            Ok(())
        }
        Some("explain") => {
            // Tuning aid: misses and false alarms with context. Use the dev split only.
            let kind_filter = arg(args, "--kind");
            for d in corpus(DEV_SEED, "dev", DOCS_PER_SPLIT) {
                for line in explain(&d) {
                    if kind_filter
                        .as_ref()
                        .is_none_or(|k| line.starts_with(&format!("{k} ")))
                    {
                        println!("{} {line}", d.id);
                    }
                }
            }
            Ok(())
        }
        Some("eval") => {
            // One extra seed that no rule has ever seen, printed and never written into the report.
            if let Some(s) = arg(args, "--seed") {
                let seed = u64::from_str_radix(s.trim_start_matches("0x"), 16)
                    .map_err(|e| format!("--seed wants a hex number: {e}"))?;
                let docs = corpus(seed, "audit", DOCS_PER_SPLIT);
                print!("{}", markdown("Audit seed", seed, &evaluate(&docs)));
                return Ok(());
            }
            let only_dev = args.iter().any(|a| a == "--dev-only");
            let mut out = String::new();
            for (seed, split, title) in [
                (
                    DEV_SEED,
                    "dev",
                    "Development seed (rules were tuned on this one)",
                ),
                (
                    TEST_SEED,
                    "test",
                    "Test seed (reported once, never tuned on)",
                ),
            ] {
                if only_dev && split == "test" {
                    continue;
                }
                let docs = corpus(seed, split, DOCS_PER_SPLIT);
                out.push_str(&markdown(title, seed, &evaluate(&docs)));
                out.push('\n');
            }
            match arg(args, "--update") {
                None => print!("{out}"),
                Some(file) => {
                    let old = fs::read_to_string(&file).map_err(|e| format!("{file}: {e}"))?;
                    let (Some(a), Some(b)) = (old.find(BEGIN), old.find(END)) else {
                        return Err(format!("{file}: markers {BEGIN} / {END} not found"));
                    };
                    let new = format!("{}{BEGIN}\n\n{out}{}", &old[..a], &old[b..]);
                    fs::write(&file, new).map_err(|e| e.to_string())?;
                    println!("updated {file}");
                }
            }
            Ok(())
        }
        _ => Err("usage: corpus-gen gen [--out-dir DIR] | eval [--update FILE]".into()),
    }
}

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    match run(&args) {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("corpus-gen: {e}");
            ExitCode::FAILURE
        }
    }
}
