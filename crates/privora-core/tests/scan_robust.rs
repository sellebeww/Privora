// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Vassel Goleyu
//! Full pipeline robustness: scan, redact, tokenise and restore must never panic, must keep the
//! round trip, and must finish in bounded time on 10 MB inputs. Synthetic data only.
#![allow(
    clippy::arithmetic_side_effects,
    clippy::expect_used,
    clippy::indexing_slicing,
    clippy::unwrap_used
)]

use std::time::{Duration, Instant};

use privora_core::{
    Date, RedactStyle, RestoreMode, ScanOptions, Sensitivity, Span, redact, restore, scan, tokenize,
};
use proptest::prelude::*;

const TODAY: Date = Date::new(2026, 11, 25);
const BUDGET_10MB: Duration = Duration::from_secs(180);

fn opts(s: Sensitivity) -> ScanOptions {
    ScanOptions {
        sensitivity: s,
        reference_date: TODAY,
    }
}

/// Run the whole pipeline and check the invariants.
fn pipeline(text: &str) {
    for s in [Sensitivity::Seimbang, Sensitivity::HatiHati] {
        let found = scan(text, &opts(s));
        let units: Vec<u16> = text.encode_utf16().collect();
        let mut last = 0;
        for f in &found {
            assert!(f.start < f.end && f.end <= units.len() && f.start >= last && !f.overlaps);
            last = f.end;
            assert!(String::from_utf16(&units[f.start..f.end]).is_ok());
        }
        let spans: Vec<Span> = found.iter().map(Span::from).collect();
        for style in [RedactStyle::Label, RedactStyle::Block] {
            redact(text, &spans, style).unwrap();
        }
        if let Ok(t) = tokenize(text, &spans) {
            for mode in [RestoreMode::Strict, RestoreMode::Tolerant] {
                assert_eq!(restore(&t.text, &t.map, mode).0, text);
            }
        }
    }
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(400))]

    #[test]
    fn arbitrary_unicode_pipeline(s in any::<String>()) {
        pipeline(&s);
    }

    #[test]
    fn label_soup_pipeline(s in "((Nama|NAMA|Alamat|Atas Nama|a\\.n\\.|Tgl Lahir|Tempat/Tgl Lahir|NIK|KK|NPWP|RT|Kota|No\\.)[:= ]{0,3}|[0-9 .\\-+@a-zA-Z]{0,12}|\n|\r\n|  |\t|\u{e9}|\u{1F600}|\\[\\[NIK_1\\]\\]){0,60}") {
        pipeline(&s);
    }
}

fn timed(label: &str, text: &str) -> Duration {
    let t0 = Instant::now();
    let found = scan(text, &opts(Sensitivity::Seimbang));
    let t_scan = t0.elapsed();
    let spans: Vec<Span> = found.iter().map(Span::from).collect();
    let t1 = Instant::now();
    let _ = redact(text, &spans, RedactStyle::Label).unwrap();
    let t_redact = t1.elapsed();
    let t2 = Instant::now();
    let tk = tokenize(text, &spans);
    let t_tok = t2.elapsed();
    let t3 = Instant::now();
    if let Ok(t) = &tk {
        assert_eq!(restore(&t.text, &t.map, RestoreMode::Strict).0, text);
    }
    let t_restore = t3.elapsed();
    println!(
        "TIMING {label}: {} bytes, {} findings, scan {t_scan:.2?}, redact {t_redact:.2?}, tokenize {t_tok:.2?}, restore {t_restore:.2?}",
        text.len(),
        found.len()
    );
    t_scan + t_redact + t_tok + t_restore
}

fn repeat_to(block: &str, bytes: usize) -> String {
    block.repeat(bytes / block.len() + 1)
}

#[test]
fn ten_megabytes_realistic_document() {
    let block = "Nama: Budi Santoso\nNIK: 3201731508900001\nTempat/Tgl Lahir: Bogor, 15-08-1990\n\
                 Alamat: Jl. Mawar No. 1\nRT 001/RW 002\nTelp: 0812 3456 7890, email budi@contoh.id\n\
                 Rapat dimulai pukul 10.00; nomor resi 1234567890123456; versi 3.12.4.1002.\n\n";
    let text = repeat_to(block, 10 * 1024 * 1024);
    assert!(timed("realistic", &text) < BUDGET_10MB);
}

#[test]
fn ten_megabytes_pathological_inputs() {
    for (label, block) in [
        ("nama-colon", "Nama:"),
        ("nama-space-colon", "Nama  "),
        ("alamat-lines", "Alamat: x\nRT\n"),
        ("brackets", "[["),
        ("token-like-open", "[[a_1 "),
        ("token-like-closed", "[[NIK_1]]"),
        ("tgl", "Tgl Lahir: 1 "),
        ("a.n.", "a.n.= "),
    ] {
        let text = repeat_to(block, 10 * 1024 * 1024);
        assert!(timed(label, &text) < BUDGET_10MB, "{label}");
    }
    let spaces = format!("Nama{}:", " ".repeat(10 * 1024 * 1024));
    assert!(timed("one-long-space-run", &spaces) < BUDGET_10MB);
    let long_line = format!("Alamat: {}", "x".repeat(10 * 1024 * 1024));
    assert!(timed("one-long-address", &long_line) < BUDGET_10MB);
}
