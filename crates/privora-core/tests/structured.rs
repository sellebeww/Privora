// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Vassel Goleyu
//! Structured detector tests. All numbers and names are synthetic.
#![allow(
    clippy::arithmetic_side_effects,
    clippy::expect_used,
    clippy::indexing_slicing,
    clippy::unwrap_used
)]

use privora_core::nik::NikError;
use privora_core::{
    Confidence, Date, Finding, Kind, ScanOptions, Sensitivity, Validation, scan_structured,
};

const TODAY: Date = Date::new(2026, 11, 25);
/// Valid structure: province 32, born 15-08-1990, male.
const NIK: &str = "3201731508900001";

fn scan(text: &str) -> Vec<Finding> {
    scan_structured(text, &ScanOptions::new(TODAY))
}

fn scan_careful(text: &str) -> Vec<Finding> {
    let o = ScanOptions {
        sensitivity: Sensitivity::HatiHati,
        reference_date: TODAY,
    };
    scan_structured(text, &o)
}

/// Slice the way JavaScript does: by UTF-16 code units.
fn js_slice(text: &str, f: &Finding) -> String {
    let u: Vec<u16> = text.encode_utf16().collect();
    String::from_utf16(&u[f.start..f.end]).expect("slice on code point boundary")
}

fn of(v: &[Finding], k: Kind) -> Vec<&Finding> {
    v.iter().filter(|f| f.kind == k).collect()
}

fn one(text: &str, k: Kind) -> Finding {
    let v = scan(text);
    let m = of(&v, k);
    assert_eq!(m.len(), 1, "{text:?} -> {v:?}");
    m[0].clone()
}

fn none(text: &str, k: Kind) {
    let v = scan(text);
    assert!(of(&v, k).is_empty(), "{text:?} -> {v:?}");
}

/// Append a Luhn check digit to `prefix`.
fn with_luhn(prefix: &str) -> String {
    for d in 0..10 {
        let s = format!("{prefix}{d}");
        if luhn(&s) {
            return s;
        }
    }
    unreachable!()
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

// ---------- NIK detector ----------

#[test]
fn nik_valid_without_keyword_is_sedang() {
    let t = format!("Ref {NIK} selesai");
    let f = one(&t, Kind::Nik);
    assert_eq!(f.confidence, Confidence::Sedang);
    assert_eq!(f.reason, "NIK_STRUKTUR_VALID");
    assert_eq!(js_slice(&t, &f), NIK);
    assert!(matches!(f.validation, Some(Validation::Nik(Ok(_)))));
}

#[test]
fn nik_valid_with_keyword_is_tinggi() {
    for kw in [
        "NIK: ",
        "nik ",
        "KTP No. ",
        "No. Identitas: ",
        "Nomor Induk Kependudukan = ",
    ] {
        let t = format!("{kw}{NIK}");
        let f = one(&t, Kind::Nik);
        assert_eq!(f.confidence, Confidence::Tinggi, "{kw}");
        assert_eq!(f.reason, "NIK_STRUKTUR_VALID_KATA_KUNCI");
    }
}

#[test]
fn nik_keyword_window_40_chars_same_or_previous_line() {
    // Previous line: near enough.
    assert_eq!(
        one(&format!("NIK\n{NIK}"), Kind::Nik).confidence,
        Confidence::Tinggi
    );
    assert_eq!(
        one(&format!("NIK\r\n{NIK}"), Kind::Nik).confidence,
        Confidence::Tinggi
    );
    // Two lines up: too far.
    assert_eq!(
        one(&format!("NIK\nx\n{NIK}"), Kind::Nik).confidence,
        Confidence::Sedang
    );
    // Exactly at the 40 character limit counts, one more does not.
    let pad39 = "a".repeat(40 - 4); // "NIK " is 4 chars, so keyword+pad+space reaches 40 back
    let near = format!("NIK {pad39}{NIK}");
    assert_eq!(one(&near, Kind::Nik).confidence, Confidence::Tinggi);
    let far = format!("NIK {pad39}a{NIK}");
    assert_eq!(one(&far, Kind::Nik).confidence, Confidence::Sedang);
}

#[test]
fn nik_keyword_is_case_insensitive_and_word_bounded() {
    assert_eq!(
        one(&format!("Ktp {NIK}"), Kind::Nik).confidence,
        Confidence::Tinggi
    );
    assert_eq!(
        one(&format!("SENIK {NIK}"), Kind::Nik).confidence,
        Confidence::Sedang
    );
    assert_eq!(
        one(&format!("KTPX {NIK}"), Kind::Nik).confidence,
        Confidence::Sedang
    );
    assert_eq!(
        one(&format!("(NIK){NIK}"), Kind::Nik).confidence,
        Confidence::Tinggi
    );
}

#[test]
fn nik_grouped_forms_6_6_4_and_4_4_4_4() {
    for sep in [' ', '.', '-'] {
        let a = format!("320173{sep}150890{sep}0001");
        let f = one(&a, Kind::Nik);
        assert_eq!(js_slice(&a, &f), a);
        let b = format!("3201{sep}7315{sep}0890{sep}0001");
        let f = one(&b, Kind::Nik);
        assert_eq!(js_slice(&b, &f), b);
    }
}

#[test]
fn nik_mixed_or_other_separators_are_not_grouped_forms() {
    none("320173 150890-0001", Kind::Nik);
    none("320173/150890/0001", Kind::Nik);
    none("3201 7315 0890-0001", Kind::Nik);
    none("320173  150890  0001", Kind::Nik); // two spaces
}

#[test]
fn nik_rejects_part_of_longer_digit_run() {
    none("32017315089000012", Kind::Nik); // 17 digits
    none("93201731508900001", Kind::Nik); // digit before
    none("320173150890000", Kind::Nik); // 15 digits
    none("320173 150890 00012", Kind::Nik);
    none("1320173 150890 0001", Kind::Nik);
    none("3201 7315 0890 00012", Kind::Nik);
    // A non-digit neighbour is fine.
    one(&format!("a{NIK}b"), Kind::Nik);
    one(&format!("({NIK})"), Kind::Nik);
    one(&format!("{NIK}."), Kind::Nik);
}

#[test]
fn nik_invalid_structure_with_keyword_is_rendah() {
    let t = "NIK: 9901731508900001"; // province 99
    let f = one(t, Kind::Nik);
    assert_eq!(f.confidence, Confidence::Rendah);
    assert_eq!(f.reason, "NIK_STRUKTUR_TIDAK_VALID");
    assert_eq!(
        f.validation,
        Some(Validation::Nik(Err(NikError::UnknownProvince)))
    );
}

#[test]
fn nik_invalid_structure_without_keyword_balanced_vs_careful() {
    let t = "Kode 9901731508900001 selesai";
    none(t, Kind::Nik);
    let v = scan_careful(t);
    let f = of(&v, Kind::Nik);
    assert_eq!(f.len(), 1);
    assert_eq!(f[0].confidence, Confidence::Rendah);
    assert_eq!(f[0].reason, "NIK_16_DIGIT_HATI_HATI");
}

#[test]
fn nik_careful_keeps_higher_confidence_for_valid_numbers() {
    let t = format!("NIK {NIK}{}{NIK}", " ".repeat(50));
    let v = scan_careful(&t);
    let n = of(&v, Kind::Nik);
    assert_eq!(n.len(), 2);
    assert!(
        n.iter()
            .all(|f| f.confidence == Confidence::Tinggi || f.confidence == Confidence::Sedang)
    );
    assert_eq!(n[0].confidence, Confidence::Tinggi);
    assert_eq!(n[1].confidence, Confidence::Sedang);
}

#[test]
fn nik_careful_flags_random_16_digits_in_grouped_form_too() {
    let v = scan_careful("id 1111 2222 3333 4444 ok");
    assert_eq!(of(&v, Kind::Nik).len(), 1);
}

// ---------- KK ----------

#[test]
fn kk_needs_keyword_and_valid_province() {
    for kw in ["No. KK: ", "Kartu Keluarga ", "KK "] {
        let f = one(&format!("{kw}{NIK}"), Kind::Kk);
        assert_eq!(f.confidence, Confidence::Tinggi, "{kw}");
    }
    none(&format!("No. KK: {}", "9901731508900001"), Kind::Kk);
    none(&format!("Nomor {NIK}"), Kind::Kk);
}

#[test]
fn kk_date_part_is_not_validated_like_nik() {
    // Day 99 would fail R3 for a NIK; a KK only needs the province.
    let f = one("No. KK: 3201739912220001", Kind::Kk);
    assert_eq!(f.confidence, Confidence::Tinggi);
}

#[test]
fn kk_and_nik_on_same_range_overlap_and_order_is_fixed() {
    let t = format!("KK {NIK}");
    let v = scan(&t);
    assert_eq!(v.len(), 2, "{v:?}");
    assert_eq!(v[0].kind, Kind::Nik);
    assert_eq!(v[1].kind, Kind::Kk);
    assert!(v.iter().all(|f| f.overlaps));
}

// ---------- NPWP ----------

#[test]
fn npwp_formatted_is_tinggi_without_keyword() {
    let t = "x 01.234.567.8-901.234 y";
    let f = one(t, Kind::Npwp);
    assert_eq!(f.confidence, Confidence::Tinggi);
    assert_eq!(js_slice(t, &f), "01.234.567.8-901.234");
}

#[test]
fn npwp_15_digits_needs_keyword() {
    let f = one("NPWP: 012345678901234", Kind::Npwp);
    assert_eq!(f.confidence, Confidence::Sedang);
    none("Nomor 012345678901234", Kind::Npwp);
    none("NPWP: 0123456789012345678", Kind::Npwp);
}

#[test]
fn npwp_16_digits_with_keyword_is_tinggi_and_beats_nik_label() {
    let t = format!("NPWP {NIK}");
    let v = scan(&t);
    let n = of(&v, Kind::Npwp);
    assert_eq!(n.len(), 1);
    assert_eq!(n[0].confidence, Confidence::Tinggi);
    assert!(n[0].overlaps);
    assert!(of(&v, Kind::Nik).iter().all(|f| f.overlaps));
}

#[test]
fn npwp_malformed_formatted_shapes_rejected() {
    none("1.234.567.8-901.234", Kind::Npwp);
    none("01.234.567.8-901.2345", Kind::Npwp);
    none("01.234.567.8.901.234", Kind::Npwp);
    none("01.234.567.8-901-234", Kind::Npwp);
    none("101.234.567.8-901.234", Kind::Npwp);
}

// ---------- Phone ----------

#[test]
fn phone_prefix_forms() {
    for (t, want) in [
        ("+6281234567890", "+6281234567890"),
        ("6281234567890", "6281234567890"),
        ("081234567890", "081234567890"),
        ("+62 812-3456-7890", "+62 812-3456-7890"),
        ("0812 3456 7890", "0812 3456 7890"),
        ("0812.3456.7890", "0812.3456.7890"),
        ("0812-3456-7890", "0812-3456-7890"),
        ("62-812-3456-7890", "62-812-3456-7890"),
    ] {
        let text = format!("Hubungi {t} segera");
        let f = one(&text, Kind::Phone);
        assert_eq!(js_slice(&text, &f), want);
    }
}

#[test]
fn phone_confidence_keyword() {
    assert_eq!(
        one("081234567890", Kind::Phone).confidence,
        Confidence::Sedang
    );
    for kw in ["Telp: ", "HP ", "WA ", "WhatsApp: ", "Phone ", "Kontak "] {
        let f = one(&format!("{kw}081234567890"), Kind::Phone);
        assert_eq!(f.confidence, Confidence::Tinggi, "{kw}");
    }
}

#[test]
fn phone_digit_count_bounds_after_prefix() {
    none("08123456", Kind::Phone); // 8 digits after the 0 prefix: "8123456" is 7
    none("081234567", Kind::Phone); // 8 digits "81234567"
    one("0812345678", Kind::Phone); // 9 digits
    one("08123456789", Kind::Phone); // 10
    one("0812345678901", Kind::Phone); // 12 digits
    none("08123456789012", Kind::Phone); // 13 digits
    one("+62812345678", Kind::Phone); // 9 digits after +62
    none("+6281234567", Kind::Phone); // 8 digits
    one("+62812345678901", Kind::Phone); // 12 digits
    none("+628123456789012", Kind::Phone); // 13 digits
}

#[test]
fn phone_must_start_with_8_after_prefix() {
    none("0712345678901", Kind::Phone);
    none("0912345678901", Kind::Phone);
    none("+62712345678901", Kind::Phone);
}

#[test]
fn phone_not_part_of_longer_digit_run() {
    none("10812345678", Kind::Phone);
    none("0812345678901234", Kind::Phone);
    none("1+62812345678", Kind::Phone);
    none("08123456789012345", Kind::Phone);
    none("2024-08-12 10:30", Kind::Phone);
}

#[test]
fn phone_trailing_punctuation_and_following_groups() {
    let t = "Telp 081234567890.";
    let f = one(t, Kind::Phone);
    assert_eq!(js_slice(t, &f), "081234567890");
    // Extra digit groups beyond 12 digits stay out of the match.
    let t = "0812 3456 7890 1234 5678";
    let f = one(t, Kind::Phone);
    assert_eq!(js_slice(t, &f), "0812 3456 7890");
}

// ---------- Email ----------

#[test]
fn email_common_forms() {
    for e in [
        "budi.santoso@example.com",
        "budi+tag@example.com",
        "b_u-d%i@mail.example.co.id",
        "BUDI@EXAMPLE.COM",
        "a1@sub.domain.example.org",
        "x@y.io",
    ] {
        let t = format!("Surel: {e} terima kasih");
        let f = one(&t, Kind::Email);
        assert_eq!(js_slice(&t, &f), e);
        assert_eq!(f.confidence, Confidence::Tinggi);
    }
}

#[test]
fn email_excludes_trailing_sentence_punctuation() {
    for (t, want) in [
        ("Kirim ke a@b.com.", "a@b.com"),
        ("(a@b.com)", "a@b.com"),
        ("a@b.com, lalu", "a@b.com"),
        ("a@b.com! ok", "a@b.com"),
        ("a@b.com;", "a@b.com"),
        ("<a@b.com>", "a@b.com"),
        ("a@b.com...", "a@b.com"),
        ("\"a@b.com\"", "a@b.com"),
    ] {
        let f = one(t, Kind::Email);
        assert_eq!(js_slice(t, &f), want, "{t}");
    }
}

#[test]
fn email_not_an_email() {
    for t in [
        "a@",
        "@b.com",
        "a@b",
        "user@localhost",
        "@Override",
        "x@y.z",
        "a @ b.com",
        "a@@b.com",
        "price@5",
        "arr[i]@2",
        "a@b.c0m",
        "a@-b.com",
        "a@b..com",
        "@",
        "@@@",
    ] {
        none(t, Kind::Email);
    }
}

// ---------- Card ----------

#[test]
fn card_luhn_valid_plain_and_grouped() {
    let n = with_luhn("411111111111111");
    assert_eq!(n.len(), 16);
    let f = one(&format!("bayar {n} ok"), Kind::Card);
    assert_eq!(f.confidence, Confidence::Sedang);
    for sep in [' ', '-'] {
        let g = format!(
            "{}{sep}{}{sep}{}{sep}{}",
            &n[0..4],
            &n[4..8],
            &n[8..12],
            &n[12..16]
        );
        let t = format!("bayar {g} ok");
        let f = one(&t, Kind::Card);
        assert_eq!(js_slice(&t, &f), g);
    }
}

#[test]
fn card_luhn_invalid_rejected() {
    let good = with_luhn("411111111111111");
    let last = good.chars().last().unwrap().to_digit(10).unwrap();
    let bad = format!("{}{}", &good[..15], (last + 1) % 10);
    none(&bad, Kind::Card);
}

#[test]
fn card_lengths_13_to_19() {
    for len in 13..=19 {
        let prefix = format!("4{}", "2".repeat(len - 2));
        let n = with_luhn(&prefix);
        assert_eq!(n.len(), len);
        one(&n, Kind::Card);
    }
    none(&with_luhn(&format!("4{}", "2".repeat(10))), Kind::Card); // 12 digits
    none(&with_luhn(&format!("4{}", "2".repeat(18))), Kind::Card); // 20 digits
}

#[test]
fn card_grouped_13_and_19_digits() {
    let n13 = with_luhn("422222222222");
    let t = format!(
        "{} {} {} {}",
        &n13[0..4],
        &n13[4..8],
        &n13[8..12],
        &n13[12..]
    );
    one(&t, Kind::Card);
    let n19 = with_luhn(&format!("6{}", "3".repeat(17)));
    let t = format!(
        "{} {} {} {} {}",
        &n19[0..4],
        &n19[4..8],
        &n19[8..12],
        &n19[12..16],
        &n19[16..]
    );
    let f = one(&t, Kind::Card);
    assert_eq!(js_slice(&t, &f), t);
}

#[test]
fn card_first_digit_must_be_3_to_6() {
    for d in ['0', '1', '2', '7', '8', '9'] {
        let n = with_luhn(&format!("{d}11111111111111"));
        none(&n, Kind::Card);
    }
    for d in ['3', '4', '5', '6'] {
        one(&with_luhn(&format!("{d}11111111111111")), Kind::Card);
    }
}

#[test]
fn card_separators_other_than_per_four_rejected() {
    let n = with_luhn("411111111111111");
    none(&format!("{} {}", &n[0..6], &n[6..]), Kind::Card);
    none(
        &format!("{}/{}/{}/{}", &n[0..4], &n[4..8], &n[8..12], &n[12..]),
        Kind::Card,
    );
    none(
        &format!("{} {}-{} {}", &n[0..4], &n[4..8], &n[8..12], &n[12..]),
        Kind::Card,
    );
}

#[test]
fn card_keyword_is_tinggi_and_longer_digit_run_is_rejected() {
    let n = with_luhn("411111111111111");
    for kw in ["Kartu kredit ", "card ", "CC: ", "debit "] {
        assert_eq!(
            one(&format!("{kw}{n}"), Kind::Card).confidence,
            Confidence::Tinggi,
            "{kw}"
        );
    }
    none(&format!("{n}1"), Kind::Card);
    none(&format!("1{n}"), Kind::Card);
}

// ---------- Overlap marker, order, offsets ----------

#[test]
fn separated_findings_do_not_overlap_and_are_sorted() {
    let t = format!("a@b.com lalu 0812 3456 7890 lalu NIK {NIK}");
    let v = scan(&t);
    assert_eq!(v.len(), 3, "{v:?}");
    assert!(v.windows(2).all(|w| w[0].start <= w[1].start));
    assert!(v.iter().all(|f| !f.overlaps));
    assert_eq!(
        v.iter().map(|f| f.kind).collect::<Vec<_>>(),
        vec![Kind::Email, Kind::Phone, Kind::Nik]
    );
}

#[test]
fn overlapping_candidates_are_all_flagged() {
    // 16 digits that are a valid NIK and also a Luhn-valid card number.
    let mut found = None;
    for serial in 1..=9999u32 {
        let n = format!("320173150890{serial:04}");
        if luhn(&n) {
            found = Some(n);
            break;
        }
    }
    let n = found.unwrap();
    let v = scan(&format!("Kartu kredit {n}"));
    assert!(
        of(&v, Kind::Nik).len() == 1 && of(&v, Kind::Card).len() == 1,
        "{v:?}"
    );
    assert!(v.iter().all(|f| f.overlaps));
}

#[test]
fn offsets_are_utf16_with_emoji_astral_and_diacritics() {
    let texts = [
        format!("😀 NIK: {NIK} 😀 a@b.com é 0812 3456 7890"),
        format!("Cafe\u{301} ünïcödé {NIK}"),
        format!("𝒳𝒴𝒵 {NIK} 𝒳 budi@example.com 😀😀 Telp 081234567890"),
        "日本語のテキスト NPWP 01.234.567.8-901.234 終わり".to_string(),
        format!("\u{1F468}\u{200D}\u{1F469}\u{200D}\u{1F467} KK {NIK}"),
    ];
    for t in &texts {
        let v = scan(t);
        assert!(!v.is_empty(), "{t:?}");
        let len16 = t.encode_utf16().count();
        for f in &v {
            assert!(f.start < f.end && f.end <= len16);
            let s = js_slice(t, f);
            let ok = match f.kind {
                Kind::Nik | Kind::Kk => s == NIK,
                Kind::Email => s.contains('@'),
                Kind::Phone => s.chars().any(|c| c.is_ascii_digit()) && s.len() >= 10,
                Kind::Npwp => s == "01.234.567.8-901.234" || s == NIK,
                _ => true,
            };
            assert!(ok, "{t:?} -> {f:?} -> {s:?}");
        }
    }
}

#[test]
fn offsets_match_known_utf16_positions() {
    // "😀" is 2 UTF-16 units, "é" (precomposed) is 1.
    let t = format!("😀é{NIK}");
    let f = one(&t, Kind::Nik);
    assert_eq!((f.start, f.end), (3, 19));
}

#[test]
fn empty_and_tiny_inputs_yield_nothing() {
    for t in ["", " ", "\n", "😀", "é", "0", "@"] {
        assert!(scan(t).is_empty(), "{t:?}");
    }
}

#[test]
fn deterministic_output() {
    let t = format!("NIK {NIK} KK {NIK} NPWP {NIK} a@b.com 081234567890");
    assert_eq!(scan(&t), scan(&t));
}
