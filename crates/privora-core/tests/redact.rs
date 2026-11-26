// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Vassel Goleyu
//! Permanent redaction: LABEL and BLOK styles, manual spans, find_all.
#![allow(
    clippy::arithmetic_side_effects,
    clippy::expect_used,
    clippy::indexing_slicing,
    clippy::unwrap_used
)]

use privora_core::{
    Date, Kind, RedactError, RedactStyle, ScanOptions, Span, find_all, redact, scan,
};
use proptest::prelude::*;

const NIK: &str = "3201731508900001";

fn sp(start: usize, end: usize, kind: Option<Kind>) -> Span {
    Span { start, end, kind }
}

#[test]
fn label_style_per_kind() {
    let cases = [
        (Kind::Nik, "[NIK]"),
        (Kind::Kk, "[KK]"),
        (Kind::Npwp, "[NPWP]"),
        (Kind::Phone, "[TELEPON]"),
        (Kind::Email, "[EMAIL]"),
        (Kind::Card, "[KARTU]"),
        (Kind::Name, "[NAMA]"),
        (Kind::Address, "[ALAMAT]"),
        (Kind::BirthDate, "[TGL_LAHIR]"),
    ];
    for (k, want) in cases {
        assert_eq!(
            redact("a SECRET b", &[sp(2, 8, Some(k))], RedactStyle::Label).unwrap(),
            format!("a {want} b")
        );
    }
}

#[test]
fn manual_span_without_kind_is_data() {
    assert_eq!(
        redact("xx yy", &[sp(3, 5, None)], RedactStyle::Label).unwrap(),
        "xx [DATA]"
    );
}

#[test]
fn block_style_is_eight_blocks_whatever_the_length() {
    let eight = "\u{2588}".repeat(8);
    assert_eq!(
        redact("a1b", &[sp(1, 2, Some(Kind::Nik))], RedactStyle::Block).unwrap(),
        format!("a{eight}b")
    );
    let long = "9".repeat(500);
    let t = format!("x{long}y");
    assert_eq!(
        redact(&t, &[sp(1, 501, None)], RedactStyle::Block).unwrap(),
        format!("x{eight}y")
    );
}

#[test]
fn original_value_is_gone_and_surroundings_kept() {
    let t = format!("NIK: {NIK}.");
    let f = scan(&t, &ScanOptions::new(Date::new(2026, 11, 25)));
    let spans: Vec<Span> = f.iter().map(Span::from).collect();
    for style in [RedactStyle::Label, RedactStyle::Block] {
        let out = redact(&t, &spans, style).unwrap();
        assert!(
            !out.contains(NIK) && out.starts_with("NIK: ") && out.ends_with('.'),
            "{out}"
        );
    }
}

#[test]
fn utf16_offsets_with_emoji_and_diacritics() {
    let t = "\u{1F600} caf\u{e9} 081234567890 \u{1F600}";
    // "😀"=2 units, then " café " = 6 -> phone starts at 8, 12 digits
    let out = redact(t, &[sp(8, 20, Some(Kind::Phone))], RedactStyle::Label).unwrap();
    assert_eq!(out, "\u{1F600} caf\u{e9} [TELEPON] \u{1F600}");
}

#[test]
fn spans_are_order_independent_and_adjacent_spans_stay_separate() {
    let a = redact(
        "aabbcc",
        &[sp(4, 6, None), sp(0, 2, None)],
        RedactStyle::Label,
    )
    .unwrap();
    assert_eq!(a, "[DATA]bb[DATA]");
    let b = redact(
        "aabb",
        &[sp(0, 2, Some(Kind::Nik)), sp(2, 4, Some(Kind::Kk))],
        RedactStyle::Label,
    )
    .unwrap();
    assert_eq!(b, "[NIK][KK]");
}

#[test]
fn manual_span_overlapping_automatic_one_is_merged_and_covers_both() {
    // auto NIK at 4..8, manual 6..12: merged 4..12, one distinct kind (NIK) survives
    let out = redact(
        "abc 12345678901 z",
        &[sp(4, 8, Some(Kind::Nik)), sp(6, 12, None)],
        RedactStyle::Label,
    )
    .unwrap();
    assert_eq!(out, "abc [NIK]901 z");
}

#[test]
fn merged_spans_of_different_kinds_become_data() {
    let out = redact(
        "0123456789",
        &[sp(0, 5, Some(Kind::Nik)), sp(3, 8, Some(Kind::Phone))],
        RedactStyle::Label,
    )
    .unwrap();
    assert_eq!(out, "[DATA]89");
}

#[test]
fn nested_and_duplicate_spans() {
    let out = redact(
        "0123456789",
        &[
            sp(1, 9, Some(Kind::Nik)),
            sp(2, 4, None),
            sp(1, 9, Some(Kind::Nik)),
        ],
        RedactStyle::Label,
    )
    .unwrap();
    assert_eq!(out, "0[NIK]9");
}

#[test]
fn empty_span_list_and_empty_spans_change_nothing() {
    assert_eq!(redact("abc", &[], RedactStyle::Label).unwrap(), "abc");
    assert_eq!(
        redact("abc", &[sp(1, 1, None)], RedactStyle::Block).unwrap(),
        "abc"
    );
    assert_eq!(redact("", &[], RedactStyle::Label).unwrap(), "");
}

#[test]
fn invalid_spans_are_errors() {
    assert_eq!(
        redact("abc", &[sp(2, 9, None)], RedactStyle::Label),
        Err(RedactError::InvalidSpan)
    );
    assert_eq!(
        redact("abc", &[sp(2, 1, None)], RedactStyle::Label),
        Err(RedactError::InvalidSpan)
    );
    assert_eq!(
        redact("a\u{1F600}b", &[sp(2, 3, None)], RedactStyle::Label),
        Err(RedactError::InvalidSpan)
    ); // inside the pair
    assert_eq!(
        redact("a\u{1F600}b", &[sp(0, 2, None)], RedactStyle::Label),
        Err(RedactError::InvalidSpan)
    );
    assert!(redact("a\u{1F600}b", &[sp(1, 3, None)], RedactStyle::Label).is_ok());
}

#[test]
fn find_all_exact_non_overlapping_utf16() {
    assert_eq!(
        find_all("ab ab abab", "ab"),
        vec![(0, 2), (3, 5), (6, 8), (8, 10)]
    );
    assert_eq!(find_all("aaaa", "aa"), vec![(0, 2), (2, 4)]);
    assert_eq!(
        find_all("Budi budi", "budi"),
        vec![(5, 9)],
        "case sensitive"
    );
    assert!(find_all("abc", "").is_empty());
    assert!(find_all("abc", "abcd").is_empty());
    let t = "\u{1F600} x \u{1F600}x";
    assert_eq!(find_all(t, "x"), vec![(3, 4), (7, 8)]);
    assert_eq!(find_all(t, "\u{1F600}"), vec![(0, 2), (5, 7)]);
}

#[test]
fn find_all_feeds_redact() {
    let t = "Budi dan Budi";
    let spans: Vec<Span> = find_all(t, "Budi")
        .into_iter()
        .map(|(s, e)| sp(s, e, Some(Kind::Name)))
        .collect();
    assert_eq!(
        redact(t, &spans, RedactStyle::Label).unwrap(),
        "[NAMA] dan [NAMA]"
    );
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(400))]

    /// No redacted character survives: for random text and random valid spans every covered unit is gone
    /// (checked by redacting with BLOK and comparing the kept text to the uncovered text).
    #[test]
    fn random_spans_remove_exactly_the_covered_text(s in "[a-z0-9 \u{e9}\u{1F600}]{0,80}", cuts in proptest::collection::vec((0usize..90, 0usize..20), 0..6)) {
        let units: Vec<u16> = s.encode_utf16().collect();
        let ok = |i: usize| i <= units.len() && !(i > 0 && i < units.len() && (0xDC00..0xE000).contains(&units[i]));
        let mut spans = vec![];
        for (a, l) in cuts {
            let b = (a + l).min(units.len());
            if ok(a) && ok(b) && a < b { spans.push(sp(a, b, None)); }
        }
        let out = redact(&s, &spans, RedactStyle::Block).unwrap();
        let mut covered = vec![false; units.len()];
        for s in &spans {
            covered[s.start..s.end].fill(true);
        }
        let kept: Vec<u16> = units.iter().zip(&covered).filter(|(_, c)| !**c).map(|(u, _)| *u).collect();
        let kept_s = String::from_utf16(&kept).unwrap();
        let stripped = out.replace('\u{2588}', "");
        assert_eq!(stripped, kept_s);
    }
}
