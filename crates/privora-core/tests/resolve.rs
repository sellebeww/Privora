// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Vassel Goleyu
//! Overlap resolution. All numbers are synthetic.
#![allow(
    clippy::arithmetic_side_effects,
    clippy::expect_used,
    clippy::indexing_slicing,
    clippy::unwrap_used
)]

use privora_core::{
    Confidence, Date, Finding, Kind, ScanOptions, Sensitivity, scan, scan_structured,
};
use proptest::prelude::*;

const TODAY: Date = Date::new(2026, 11, 25);
/// Valid NIK structure (province 32, born 15-08-1990).
const NIK: &str = "3201731508900001";

fn run(text: &str) -> Vec<Finding> {
    scan(text, &ScanOptions::new(TODAY))
}

fn kinds(text: &str) -> Vec<Kind> {
    run(text).iter().map(|f| f.kind).collect()
}

fn luhn(s: &str) -> bool {
    let mut sum = 0;
    for (i, c) in s.chars().rev().enumerate() {
        let mut d = c.to_digit(10).unwrap();
        if i % 2 == 1 {
            d *= 2;
            if d > 9 {
                d -= 9;
            }
        }
        sum += d;
    }
    sum % 10 == 0
}

/// A 16 digit string that is a valid NIK structure AND passes Luhn.
fn nik_and_luhn() -> String {
    (1..=9999u32)
        .map(|s| format!("320173150890{s:04}"))
        .find(|n| luhn(n))
        .unwrap()
}

fn assert_disjoint_sorted(v: &[Finding]) {
    for w in v.windows(2) {
        assert!(w[0].end <= w[1].start, "overlap or unsorted: {v:?}");
    }
    assert!(v.iter().all(|f| f.start < f.end && !f.overlaps));
}

#[test]
fn nik_vs_npwp_vs_kk_with_and_without_keyword() {
    // no keyword: plain NIK
    assert_eq!(kinds(NIK), [Kind::Nik]);
    // NIK keyword
    assert_eq!(kinds(&format!("NIK {NIK}")), [Kind::Nik]);
    // NPWP keyword beats the plain valid NIK structure
    let v = run(&format!("NPWP: {NIK}"));
    assert_eq!(v.len(), 1);
    assert_eq!(
        (v[0].kind, v[0].confidence),
        (Kind::Npwp, Confidence::Tinggi)
    );
    // KK keyword beats it too
    let v = run(&format!("No. KK: {NIK}"));
    assert_eq!(v.len(), 1);
    assert_eq!((v[0].kind, v[0].confidence), (Kind::Kk, Confidence::Tinggi));
    // keyword for another kind but invalid-structure NIK still wins by keyword
    assert_eq!(kinds("NIK 9901731508900001"), [Kind::Nik]);
}

#[test]
fn both_keywords_pick_one_by_fixed_order_and_are_stable() {
    let t = format!("NIK/NPWP: {NIK}");
    let a = run(&t);
    assert_eq!(a.len(), 1);
    assert_eq!(a[0].kind, Kind::Npwp);
    assert_eq!(run(&t), a);
    let t = format!("NIK/KK: {NIK}");
    assert_eq!(kinds(&t), [Kind::Kk]);
}

#[test]
fn nik_vs_card() {
    let n = nik_and_luhn();
    // plain: both are validated structure, same length: fixed kind order puts NIK first
    assert_eq!(kinds(&n), [Kind::Nik]);
    // card keyword wins
    let v = run(&format!("Kartu kredit {n}"));
    assert_eq!(v.len(), 1);
    assert_eq!(
        (v[0].kind, v[0].confidence),
        (Kind::Card, Confidence::Tinggi)
    );
    // NIK keyword wins
    let v = run(&format!("NIK {n}"));
    assert_eq!((v.len(), v[0].kind), (1, Kind::Nik));
}

#[test]
fn longer_range_wins_among_equal_basis() {
    // grouped card (19 digits) contains a 16 digit grouped NIK shape start; the longer card range wins
    let t = "kartu 4111 1111 1111 1111";
    assert_eq!(kinds(t), [Kind::Card]);
}

#[test]
fn structure_beats_heuristic_and_heuristic_remainder_is_kept() {
    let t = "Alamat: Jl. Mawar No. 3 hubungi 0812 3456 7890 sore hari";
    let v = run(t);
    assert_disjoint_sorted(&v);
    let phone = v
        .iter()
        .find(|f| f.kind == Kind::Phone)
        .expect("phone kept");
    assert_eq!(phone.confidence, Confidence::Sedang);
    // the address text on both sides of the phone is still covered, nothing leaks
    let u: Vec<u16> = t.encode_utf16().collect();
    let covered = |i: usize| v.iter().any(|f| f.start <= i && i < f.end);
    let phone_at = t.find("0812").unwrap();
    for (i, ch) in t.char_indices() {
        if i >= "Alamat: ".len() && !ch.is_whitespace() {
            assert!(covered(i), "uncovered {ch:?} at {i} of {} units", u.len());
        }
    }
    assert!(covered(phone_at));
    let rest: Vec<&Finding> = v.iter().filter(|f| f.kind == Kind::Address).collect();
    assert_eq!(rest.len(), 2);
    assert!(
        rest.iter()
            .all(|f| f.reason == "SISA_TUMPANG_TINDIH" && f.confidence == Confidence::Rendah)
    );
}

#[test]
fn email_inside_address_wins_and_pieces_do_not_start_or_end_with_space() {
    let t = "Alamat: Jl. X 5, email a@b.com atau pos";
    let v = run(t);
    assert_disjoint_sorted(&v);
    let units: Vec<u16> = t.encode_utf16().collect();
    for f in &v {
        let s = String::from_utf16(&units[f.start..f.end]).unwrap();
        assert_eq!(s, s.trim(), "{s:?}");
    }
    assert!(v.iter().any(|f| f.kind == Kind::Email));
}

#[test]
fn whole_candidate_inside_a_winner_disappears() {
    // NIK keyword + valid NIK: the KK-less, same range Card/Phone-like candidates vanish entirely
    let v = run(&format!("NIK: {NIK}"));
    assert_eq!(v.len(), 1);
    assert_eq!(v[0].reason, "NIK_STRUKTUR_VALID_KATA_KUNCI");
}

#[test]
fn kept_findings_keep_their_validation_and_reason() {
    let v = run(&format!("NIK {NIK}"));
    assert!(v[0].validation.is_some());
}

#[test]
fn resolved_output_never_overlaps_and_is_sorted_on_realistic_text() {
    let t = format!(
        "Nama: Budi Santoso  NIK: {NIK}\nAlamat: Jl. A 1 telp 081234567890\nRT 01\nTgl Lahir: 15-08-1990\nemail budi@contoh.id npwp 01.234.567.8-901.234"
    );
    let v = run(&t);
    assert_disjoint_sorted(&v);
    assert!(v.len() >= 6, "{v:?}");
}

#[test]
fn deterministic() {
    let t = format!("KK {NIK} NPWP {NIK} Alamat: x 0812 3456 7890\nKota Y");
    assert_eq!(run(&t), run(&t));
}

#[test]
fn careful_sensitivity_flows_through_scan() {
    let o = ScanOptions {
        sensitivity: Sensitivity::HatiHati,
        reference_date: TODAY,
    };
    assert_eq!(scan("9999999999999999", &o).len(), 1);
    assert!(scan("9999999999999999", &ScanOptions::new(TODAY)).is_empty());
}

fn covered_non_ws(text: &str, v: &[Finding]) -> Vec<bool> {
    let units: Vec<u16> = text.encode_utf16().collect();
    let mut c = vec![false; units.len()];
    for f in v {
        c[f.start..f.end].fill(true);
    }
    for (i, u) in units.iter().enumerate() {
        if char::from_u32(u32::from(*u)).is_some_and(char::is_whitespace) {
            c[i] = true; // whitespace edges may be trimmed from remainders
        }
    }
    c
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(400))]

    /// Resolution never uncovers a character that a structured detector had covered, and the result is disjoint.
    #[test]
    fn resolution_keeps_coverage_and_is_disjoint(s in "[0-9 .+@a-zA-Z:=\\-\n\u{e9}\u{1F600}]{0,300}|((NIK|KK|NPWP|Kartu|Alamat|Nama|Tgl Lahir)[:= ]*[0-9 .\\-]{0,30}[a-z ]{0,10}\n?){0,8}") {
        let o = ScanOptions::new(TODAY);
        let resolved = scan(&s, &o);
        assert_disjoint_sorted(&resolved);
        let before = scan_structured(&s, &o);
        let cov = covered_non_ws(&s, &resolved);
        for f in &before {
            assert!(cov[f.start..f.end].iter().all(|x| *x), "uncovered unit in {s:?}");
        }
    }
}
