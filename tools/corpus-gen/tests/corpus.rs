// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Vassel Goleyu
//! Structure of the synthetic corpus: determinism, offsets, validity of the generated numbers.

use corpus_gen::docs::{TEMPLATES, corpus, doc};
use corpus_gen::{DEV_SEED, DOCS_PER_SPLIT, Doc, REFERENCE_DATE, TEST_SEED};
use privora_core::Kind;
use privora_core::nik::validate_nik;

fn slice(d: &Doc, s: usize, e: usize) -> String {
    let u: Vec<u16> = d.text.encode_utf16().collect();
    String::from_utf16(&u[s..e]).expect("label on a code point boundary")
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

#[test]
fn deterministic_and_seeds_are_separate() {
    let a = corpus(DEV_SEED, "dev", 40);
    let b = corpus(DEV_SEED, "dev", 40);
    assert!(
        a.iter()
            .zip(&b)
            .all(|(x, y)| x.text == y.text && x.gold == y.gold && x.neg == y.neg)
    );
    let t = corpus(TEST_SEED, "test", 40);
    assert!(a.iter().zip(&t).all(|(x, y)| x.text != y.text));
    assert_ne!(DEV_SEED, TEST_SEED);
    // a document does not depend on the ones before it
    assert_eq!(doc(DEV_SEED, "dev", 17).text, a[17].text);
}

#[test]
fn every_template_is_used_equally_and_ids_are_unique() {
    let d = corpus(DEV_SEED, "dev", DOCS_PER_SPLIT);
    assert_eq!(d.len(), DOCS_PER_SPLIT);
    for t in TEMPLATES {
        assert_eq!(
            d.iter().filter(|x| x.template == t).count(),
            DOCS_PER_SPLIT / TEMPLATES.len(),
            "{t}"
        );
    }
    let mut ids: Vec<&str> = d.iter().map(|x| x.id.as_str()).collect();
    ids.sort();
    ids.dedup();
    assert_eq!(ids.len(), DOCS_PER_SPLIT);
}

#[test]
fn labels_point_at_real_text_are_ordered_and_do_not_overlap() {
    for d in corpus(DEV_SEED, "dev", DOCS_PER_SPLIT)
        .iter()
        .chain(&corpus(TEST_SEED, "test", DOCS_PER_SPLIT))
    {
        let units = d.text.encode_utf16().count();
        let mut all: Vec<(usize, usize)> = d
            .gold
            .iter()
            .map(|g| (g.start, g.end))
            .chain(d.neg.iter().map(|n| (n.start, n.end)))
            .collect();
        all.sort();
        for (s, e) in &all {
            assert!(s < e && *e <= units, "{}", d.id);
        }
        assert!(
            all.windows(2).all(|w| w[0].1 <= w[1].0),
            "{} has overlapping labels",
            d.id
        );
    }
}

#[test]
fn generated_numbers_have_the_claimed_structure() {
    let mut seen = std::collections::HashSet::new();
    for d in corpus(DEV_SEED, "dev", DOCS_PER_SPLIT) {
        for g in &d.gold {
            let v = slice(&d, g.start, g.end);
            let digits: String = v.chars().filter(char::is_ascii_digit).collect();
            seen.insert(g.kind);
            match g.kind {
                Kind::Nik => assert!(validate_nik(&digits, REFERENCE_DATE).is_ok(), "{v}"),
                Kind::Card => assert!(luhn(&digits) && (13..=19).contains(&digits.len()), "{v}"),
                Kind::Email => assert!(v.contains('@') && !v.contains(' '), "{v}"),
                Kind::Npwp => assert_eq!(digits.len(), 15, "{v}"),
                Kind::Kk => assert_eq!(digits.len(), 16, "{v}"),
                _ => assert!(!v.trim().is_empty()),
            }
        }
    }
    assert_eq!(seen.len(), 9, "all nine kinds appear in the dev split");
}

#[test]
fn every_hard_negative_category_is_present() {
    let d = corpus(DEV_SEED, "dev", DOCS_PER_SPLIT);
    for c in [
        "resi",
        "acak16",
        "cap_waktu",
        "kode_produk",
        "versi",
        "tanggal",
        "kata_nik_tanpa_nomor",
        "email_kode",
        "melewati_batas",
        "nomor_surat",
    ] {
        assert!(
            d.iter().any(|x| x.neg.iter().any(|n| n.category == c)),
            "{c}"
        );
    }
}

#[test]
fn offsets_are_utf16_not_bytes() {
    let d = corpus(DEV_SEED, "dev", DOCS_PER_SPLIT);
    let chat = d
        .iter()
        .find(|x| x.template == "ekspor_chat" && x.text.contains('\u{1F600}') && !x.gold.is_empty())
        .expect("chat with emoji");
    let g = chat.gold.last().unwrap();
    assert_ne!(chat.text.len(), chat.text.encode_utf16().count());
    assert!(!slice(chat, g.start, g.end).is_empty());
}

#[test]
fn no_em_dash_anywhere_in_the_data() {
    for d in corpus(DEV_SEED, "dev", DOCS_PER_SPLIT) {
        assert!(!d.text.contains('\u{2014}'));
    }
}

#[test]
fn json_lines_are_one_valid_looking_record_each() {
    let d = doc(DEV_SEED, "dev", 3);
    let j = d.to_json();
    assert!(!j.contains('\n'));
    assert!(j.starts_with("{\"id\":\"dev-0003\"") && j.ends_with("]}"));
    assert!(j.contains("\"synthetic\":true"));
    assert!(j.contains("\\n"), "newlines are escaped");
}
