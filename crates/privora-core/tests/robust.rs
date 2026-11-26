// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Vassel Goleyu
//! Property and stress tests: the engine must never panic and must finish in reasonable time.
//! Time budget used below: 120 s per 10 MB input in a debug build (worst measured: 32 s debug, 5.7 s release, see
//! docs/EVALUATION.md); a release build is far faster.
#![allow(
    clippy::arithmetic_side_effects,
    clippy::expect_used,
    clippy::indexing_slicing,
    clippy::unwrap_used
)]

use std::time::{Duration, Instant};

use privora_core::nik::validate_nik;
use privora_core::offsets::Utf16Map;
use privora_core::{Date, ScanOptions, Sensitivity, scan_structured};
use proptest::prelude::*;

const TODAY: Date = Date::new(2026, 11, 25);
const BUDGET_10MB: Duration = Duration::from_secs(120);

fn check_invariants(text: &str) {
    for sens in [Sensitivity::Seimbang, Sensitivity::HatiHati] {
        let o = ScanOptions {
            sensitivity: sens,
            reference_date: TODAY,
        };
        let v = scan_structured(text, &o);
        let units: Vec<u16> = text.encode_utf16().collect();
        let mut last = 0;
        for f in &v {
            assert!(f.start < f.end, "empty finding");
            assert!(f.end <= units.len(), "out of range");
            assert!(f.start >= last, "not sorted");
            last = f.start;
            assert!(
                String::from_utf16(&units[f.start..f.end]).is_ok(),
                "split a surrogate pair"
            );
        }
    }
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(512))]

    #[test]
    fn arbitrary_unicode_never_panics(s in any::<String>()) {
        check_invariants(&s);
    }

    #[test]
    fn digit_and_separator_soup_never_panics(s in "[0-9 .+@a-zA-Z\\-\n\r\t\u{e9}\u{1F600}]{0,400}") {
        check_invariants(&s);
    }

    #[test]
    fn sixteen_digit_strings_validate_without_panic(s in "[0-9]{0,20}", y in 1i32..3000, m in 0u8..14, d in 0u8..33) {
        let _ = validate_nik(&s, Date::new(y, m, d));
    }

    #[test]
    fn validate_nik_arbitrary_input(s in any::<String>()) {
        let _ = validate_nik(&s, TODAY);
    }

    #[test]
    fn utf16_map_matches_std(s in any::<String>()) {
        let m = Utf16Map::new(&s);
        for (b, _) in s.char_indices() {
            prop_assert_eq!(m.to_utf16(b), s[..b].encode_utf16().count());
        }
        prop_assert_eq!(m.to_utf16(s.len()), s.encode_utf16().count());
    }
}

fn timed(name: &str, text: &str) {
    let o = ScanOptions {
        sensitivity: Sensitivity::HatiHati,
        reference_date: TODAY,
    };
    let t = Instant::now();
    let v = scan_structured(text, &o);
    let el = t.elapsed();
    println!(
        "STRESS {name}: {} bytes, {} findings, {el:?}",
        text.len(),
        v.len()
    );
    assert!(el < BUDGET_10MB, "{name} took {el:?}");
}

const TEN_MB: usize = 10 * 1024 * 1024;

#[test]
fn stress_pathological_10mb_inputs() {
    timed("digits", &"1".repeat(TEN_MB));
    timed("digit-space", &"1 ".repeat(TEN_MB / 2));
    timed("digit-dash", &"12-".repeat(TEN_MB / 3));
    // These two yield millions of findings; 2 MB in debug builds keeps the suite fast.
    let heavy = if cfg!(debug_assertions) {
        TEN_MB / 5
    } else {
        TEN_MB
    };
    timed("groups4", &"1234 ".repeat(heavy / 5));
    timed("phone-like", &"0812 3456 ".repeat(heavy / 10));
    timed("plus62", &"+62 8 ".repeat(TEN_MB / 6));
    timed("at-signs", &"@".repeat(TEN_MB));
    timed("local-then-at", &format!("{}@", "a".repeat(TEN_MB)));
    timed("many-emails", &"a@b.co ".repeat(TEN_MB / 7));
    timed("dots", &"a.".repeat(TEN_MB / 2));
    timed("at-dots", &"a@b.".repeat(TEN_MB / 4));
    timed("keyword-spam", &"NIK ".repeat(TEN_MB / 4));
    timed("npwp-shape", &"01.234.567.8-901.234 ".repeat(TEN_MB / 21));
    timed("emoji", &"😀".repeat(TEN_MB / 4));
    timed("newlines", &"\n".repeat(TEN_MB));
    timed("nik-spam", &"NIK 3201731508900001\n".repeat(TEN_MB / 21));
}

#[test]
fn stress_empty_and_huge_single_token() {
    check_invariants("");
    timed("ascii-letters", &"a".repeat(TEN_MB));
}
