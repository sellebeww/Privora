// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Vassel Goleyu
//! Regression tests for past leaks. All values are invented
//! (SINTETIS). Each test states what was missed before the fix.
#![allow(clippy::unwrap_used, clippy::indexing_slicing)]

use privora_core::{Confidence, Date, Finding, Kind, ScanOptions, scan};

const NIK: &str = "3171011505900001";

fn run(text: &str) -> Vec<Finding> {
    scan(text, &ScanOptions::new(Date::new(2026, 11, 26)))
}

/// The matched text, cut out of the ORIGINAL string with the UTF-16 offsets of the finding.
fn cut(text: &str, f: &Finding) -> String {
    let units: Vec<u16> = text.encode_utf16().collect();
    String::from_utf16(&units[f.start..f.end]).unwrap()
}

fn values(text: &str, kind: Kind) -> Vec<String> {
    run(text)
        .iter()
        .filter(|f| f.kind == kind)
        .map(|f| cut(text, f))
        .collect()
}

/// F-04: a tab or a no-break space between the label and ":" hid the whole value.
#[test]
fn label_may_be_separated_from_the_colon_by_a_tab_or_no_break_space() {
    for gap in ["\t", " \t ", "\u{a0}", "\u{202f}"] {
        let t = format!(
            "Nama{gap}: Budi Contoh\nAlamat{gap}: Jl. Contoh No. 1\nTgl Lahir{gap}: 15-05-1990"
        );
        assert_eq!(values(&t, Kind::Name), ["Budi Contoh"], "{gap:?}");
        assert_eq!(values(&t, Kind::Address), ["Jl. Contoh No. 1"], "{gap:?}");
        assert_eq!(values(&t, Kind::BirthDate), ["15-05-1990"], "{gap:?}");
    }
}

/// F-05: word processors and web pages write no-break spaces and hyphens inside numbers.
#[test]
fn no_break_spaces_and_hyphens_count_as_spaces_and_hyphens() {
    for sp in ["\u{a0}", "\u{2007}", "\u{2009}", "\u{202f}"] {
        let nik = ["3171", "0115", "0590", "0001"].join(sp);
        let phone = ["0812", "5550", "0101"].join(sp);
        let card = ["4111", "1111", "1111", "1111"].join(sp);
        let name = format!("Budi{sp}Contoh");
        let t = format!("😀 NIK: {nik}\nHP: {phone}\nKartu: {card}\nNama:{sp}{name}");
        assert_eq!(values(&t, Kind::Nik), [nik], "{sp:?}");
        assert_eq!(values(&t, Kind::Phone), [phone], "{sp:?}");
        assert_eq!(values(&t, Kind::Card), [card], "{sp:?}");
        assert_eq!(values(&t, Kind::Name), [name], "{sp:?}");
    }
    for hy in ["\u{2010}", "\u{2011}"] {
        let phone = ["0812", "5550", "0101"].join(hy);
        assert_eq!(values(&format!("HP {phone}"), Kind::Phone), [phone]);
    }
}

/// F-08: a decomposed accent (NFD) cut the name in half and left the rest visible.
#[test]
fn a_name_with_combining_marks_is_covered_whole() {
    let name = "Andre\u{301} Wijaya";
    assert_eq!(values(&format!("Nama: {name}"), Kind::Name), [name]);
}

/// F-07: anything glued to the domain made the whole address disappear.
#[test]
fn an_email_followed_by_a_glued_suffix_is_still_found() {
    for tail in [".2024", "-1", ".v2", "..x"] {
        let t = format!("kirim ke budi@mail.example.com{tail} ya");
        assert_eq!(values(&t, Kind::Email), ["budi@mail.example.com"], "{tail}");
    }
    // Still not an address: no alphabetic top level label anywhere.
    for not in ["a@b", "lodash@4.17.21", "x@host.-com", "a@.com", "a@b..com"] {
        assert!(values(not, Kind::Email).is_empty(), "{not}");
    }
}

/// F-07: the fallback must stay linear.
#[test]
fn a_huge_domain_stays_fast() {
    let t = format!("a@{}", "1.".repeat(500_000));
    let started = std::time::Instant::now();
    assert!(values(&t, Kind::Email).is_empty());
    assert!(started.elapsed().as_secs() < 20, "{:?}", started.elapsed());
}

/// F-14: a window that began inside a word turned "SENIK" into the keyword "NIK".
#[test]
fn a_word_cut_by_the_keyword_window_is_not_a_keyword() {
    // "NIK" plus 37 more characters is exactly the 40 character window.
    let t = format!("SENIK{}{NIK}", " .".repeat(18) + " ");
    let f = run(&t);
    assert_eq!(f.len(), 1);
    assert_eq!(f[0].confidence, Confidence::Sedang, "{t:?}");
}
