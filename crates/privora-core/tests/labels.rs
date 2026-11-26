// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Vassel Goleyu
//! Label heuristics: name, address, birth date. All data is synthetic.
#![allow(
    clippy::arithmetic_side_effects,
    clippy::expect_used,
    clippy::indexing_slicing,
    clippy::unwrap_used
)]

use privora_core::{Confidence, Date, Finding, Kind, ScanOptions, scan};

const TODAY: Date = Date::new(2026, 11, 25);

fn all(text: &str) -> Vec<Finding> {
    scan(text, &ScanOptions::new(TODAY))
}

fn js_slice(text: &str, f: &Finding) -> String {
    let u: Vec<u16> = text.encode_utf16().collect();
    String::from_utf16(&u[f.start..f.end]).unwrap()
}

/// Values of all findings of kind `k`.
fn values(text: &str, k: Kind) -> Vec<String> {
    all(text)
        .iter()
        .filter(|f| f.kind == k)
        .map(|f| js_slice(text, f))
        .collect()
}

fn one(text: &str, k: Kind) -> (Finding, String) {
    let v = all(text);
    let m: Vec<&Finding> = v.iter().filter(|f| f.kind == k).collect();
    assert_eq!(m.len(), 1, "{text:?} -> {v:?}");
    (m[0].clone(), js_slice(text, m[0]))
}

// ---------- Name ----------

#[test]
fn name_label_variants_and_case() {
    for (t, want) in [
        ("Nama: Budi Santoso", "Budi Santoso"),
        ("NAMA : BUDI SANTOSO", "BUDI SANTOSO"),
        ("nama = budi santoso", "budi santoso"),
        ("Nama Lengkap: Siti Nurhaliza", "Siti Nurhaliza"),
        ("Nama Pemohon: Agus Salim", "Agus Salim"),
        ("Atas Nama: Dewi Lestari", "Dewi Lestari"),
        ("a.n.: Rina Marlina", "Rina Marlina"),
        ("A.N. = Rina Marlina", "Rina Marlina"),
    ] {
        let (f, v) = one(t, Kind::Name);
        assert_eq!(v, want, "{t}");
        assert_eq!(f.confidence, Confidence::Rendah);
        assert_eq!(f.reason, "NAMA_BERLABEL");
    }
}

#[test]
fn name_without_space_after_colon_and_before() {
    assert_eq!(values("Nama:Budi Santoso", Kind::Name), ["Budi Santoso"]);
    assert_eq!(values("Nama=Budi", Kind::Name), ["Budi"]);
    assert_eq!(values("x\nNama :   Budi\ny", Kind::Name), ["Budi"]);
}

#[test]
fn name_atas_nama_is_reported_once() {
    assert_eq!(values("Atas Nama: Dewi Lestari", Kind::Name).len(), 1);
}

#[test]
fn name_stops_at_digit_tab_double_space_and_eol() {
    assert_eq!(
        values("Nama: Budi Santoso 3201", Kind::Name),
        ["Budi Santoso"]
    );
    assert_eq!(
        values("Nama: Budi Santoso\tTelp", Kind::Name),
        ["Budi Santoso"]
    );
    assert_eq!(
        values("Nama: Budi Santoso  Alamat", Kind::Name),
        ["Budi Santoso"]
    );
    assert_eq!(values("Nama: Budi\nSantoso", Kind::Name), ["Budi"]);
    assert_eq!(values("Nama: Budi\r\nx", Kind::Name), ["Budi"]);
}

#[test]
fn name_takes_at_most_six_words() {
    assert_eq!(values("Nama: a b c d e f g h", Kind::Name), ["a b c d e f"]);
    assert_eq!(values("Nama: a b c d e f", Kind::Name), ["a b c d e f"]);
}

#[test]
fn name_allows_dots_apostrophes_hyphens_and_diacritics() {
    assert_eq!(values("Nama: Sri D'Arc-Ali", Kind::Name), ["Sri D'Arc-Ali"]);
    assert_eq!(
        values("Nama: Dr. Zo\u{eb} M\u{fc}ller", Kind::Name),
        ["Dr. Zo\u{eb} M\u{fc}ller"]
    );
    // trailing sentence dot is not part of a long last word
    assert_eq!(values("Nama: Budi Santoso.", Kind::Name), ["Budi Santoso"]);
    // an initial keeps its dot
    assert_eq!(values("Nama: Budi S.", Kind::Name), ["Budi S."]);
}

#[test]
fn name_stops_at_comma_and_needs_a_letter() {
    assert_eq!(
        values("Nama: Budi Santoso, S.H.", Kind::Name),
        ["Budi Santoso"]
    );
    assert!(values("Nama: 12345", Kind::Name).is_empty());
    assert!(values("Nama: ", Kind::Name).is_empty());
    assert!(values("Nama:", Kind::Name).is_empty());
    assert!(values("Nama: ...", Kind::Name).is_empty());
}

#[test]
fn name_label_needs_separator_and_word_boundary() {
    assert!(values("Nama file: laporan", Kind::Name).is_empty());
    assert!(values("Nama Budi Santoso", Kind::Name).is_empty());
    assert!(values("Namanya: Budi", Kind::Name).is_empty());
    assert!(values("Surnama: Budi", Kind::Name).is_empty());
    assert!(
        values("Budi Santoso", Kind::Name).is_empty(),
        "no unlabeled names"
    );
}

#[test]
fn name_offsets_are_utf16() {
    let t = "\u{1F600} \u{e9}\nNama: Zo\u{eb} Ng";
    let (f, v) = one(t, Kind::Name);
    assert_eq!(v, "Zo\u{eb} Ng");
    assert_eq!(f.start, 11); // "😀"=2, " "=1, "é"=1, "\n"=1, "Nama: "=6
}

// ---------- Address ----------

#[test]
fn address_single_line() {
    let t = "Alamat: Jl. Mawar No. 12, RT 003/RW 004, Kel. Sukamaju";
    let (f, v) = one(t, Kind::Address);
    assert_eq!(v, "Jl. Mawar No. 12, RT 003/RW 004, Kel. Sukamaju");
    assert_eq!(f.confidence, Confidence::Rendah);
    assert_eq!(f.reason, "ALAMAT_BERLABEL");
    assert_eq!(
        values("ALAMAT=Jl. Melati 5", Kind::Address),
        ["Jl. Melati 5"]
    );
    assert_eq!(
        values("alamat:Jl. Melati 5", Kind::Address),
        ["Jl. Melati 5"]
    );
}

#[test]
fn address_two_lines_when_continuation_starts_with_known_prefix() {
    for cont in [
        "RT 01 RW 02",
        "RW 02",
        "Kel. Sukamaju",
        "Kelurahan Sukamaju",
        "Kec. Cibeunying",
        "Kecamatan Cibeunying",
        "Kab. Bandung",
        "Kabupaten Bandung",
        "Kota Bandung",
        "No. 7",
        "  kota bandung",
    ] {
        let t = format!("Alamat: Jl. Mawar\n{cont}\nTelepon: x");
        let (_, v) = one(&t, Kind::Address);
        assert_eq!(v, format!("Jl. Mawar\n{cont}"), "{cont}");
    }
}

#[test]
fn address_second_line_not_taken_for_other_text() {
    for cont in [
        "Pekerjaan: Guru",
        "Notaris Budi",
        "Kotabaru",
        "Kelas 3",
        "RTX 4090",
        "",
    ] {
        let t = format!("Alamat: Jl. Mawar\n{cont}");
        let (_, v) = one(&t, Kind::Address);
        assert_eq!(v, "Jl. Mawar", "{cont:?}");
    }
}

#[test]
fn address_crlf_and_only_one_extra_line() {
    let t = "Alamat: Jl. Mawar\r\nRT 01\r\nRW 02\r\n";
    let (_, v) = one(t, Kind::Address);
    assert_eq!(v, "Jl. Mawar\r\nRT 01");
}

#[test]
fn address_capped_at_160_chars_and_no_continuation_after_cap() {
    let long = "x".repeat(200);
    let t = format!("Alamat: {long}\nRT 01");
    let (_, v) = one(&t, Kind::Address);
    assert_eq!(v.chars().count(), 160);
    let exact = "y".repeat(160);
    let (_, v) = one(&format!("Alamat: {exact}"), Kind::Address);
    assert_eq!(v, exact);
}

#[test]
fn address_label_needs_separator_and_a_value() {
    assert!(values("Alamat email: a@b.com", Kind::Address).is_empty());
    assert!(values("Alamat: ", Kind::Address).is_empty());
    assert!(values("Alamat:\nRT 01", Kind::Address).is_empty());
    assert!(values("Alamatnya: Jl. X", Kind::Address).is_empty());
}

#[test]
fn address_counts_chars_not_bytes() {
    let long = "\u{e9}".repeat(170);
    let (_, v) = one(&format!("Alamat: {long}"), Kind::Address);
    assert_eq!(v.chars().count(), 160);
}

// ---------- Birth date ----------

#[test]
fn birth_label_variants() {
    for (t, want) in [
        (
            "Tempat/Tgl Lahir: Jakarta, 17-08-1990",
            "Jakarta, 17-08-1990",
        ),
        (
            "Tempat/Tgl. Lahir: Jakarta, 17-08-1990",
            "Jakarta, 17-08-1990",
        ),
        (
            "Tempat, Tanggal Lahir: Bandung, 5 Agustus 1991",
            "Bandung, 5 Agustus 1991",
        ),
        (
            "Tempat/Tanggal Lahir : Medan, 01/02/1985",
            "Medan, 01/02/1985",
        ),
        ("Tgl Lahir: 17/08/1990", "17/08/1990"),
        ("Tgl. Lahir = 17-08-1990", "17-08-1990"),
        ("Tanggal Lahir:17 Agustus 1990", "17 Agustus 1990"),
        (
            "TEMPAT/TGL LAHIR: SURABAYA, 17-08-1990",
            "SURABAYA, 17-08-1990",
        ),
        ("tanggal lahir: 17-08-1990", "17-08-1990"),
    ] {
        let (f, v) = one(t, Kind::BirthDate);
        assert_eq!(v, want, "{t}");
        assert_eq!(f.confidence, Confidence::Sedang, "{t}");
        assert_eq!(f.reason, "TGL_LAHIR_FORMAT_VALID");
    }
}

#[test]
fn birth_every_indonesian_month_name_full_and_short() {
    let months = [
        ("Januari", 1),
        ("Jan", 1),
        ("Februari", 2),
        ("Pebruari", 2),
        ("Feb", 2),
        ("Maret", 3),
        ("Mar", 3),
        ("April", 4),
        ("Apr", 4),
        ("Mei", 5),
        ("Juni", 6),
        ("Jun", 6),
        ("Juli", 7),
        ("Jul", 7),
        ("Agustus", 8),
        ("Agu", 8),
        ("Agt", 8),
        ("Ags", 8),
        ("Agust", 8),
        ("September", 9),
        ("Sep", 9),
        ("Sept", 9),
        ("Oktober", 10),
        ("Okt", 10),
        ("November", 11),
        ("Nov", 11),
        ("Nopember", 11),
        ("Nop", 11),
        ("Desember", 12),
        ("Des", 12),
    ];
    for (name, _) in months {
        for t in [
            format!("Tgl Lahir: 15 {name} 1990"),
            format!("Tgl Lahir: 15 {} 1990", name.to_uppercase()),
            format!("Tgl Lahir: 15 {name}. 1990"),
        ] {
            let (f, _) = one(&t, Kind::BirthDate);
            assert_eq!(f.confidence, Confidence::Sedang, "{t}");
        }
    }
}

#[test]
fn birth_invalid_dates_are_rendah() {
    for t in [
        "Tgl Lahir: 31/02/1990",
        "Tgl Lahir: 29 Februari 1900",
        "Tgl Lahir: 32-01-1990",
        "Tgl Lahir: 15-13-1990",
        "Tgl Lahir: 0-1-1990",
        "Tgl Lahir: 15 Foo 1990",
        "Tgl Lahir: 17-08-90",
        "Tgl Lahir: Jakarta",
        "Tgl Lahir: 17-08/1990",
    ] {
        let (f, _) = one(t, Kind::BirthDate);
        assert_eq!(f.confidence, Confidence::Rendah, "{t}");
        assert_eq!(f.reason, "TGL_LAHIR_BERLABEL");
    }
}

#[test]
fn birth_leap_days() {
    for (t, ok) in [
        ("Tgl Lahir: 29 Februari 2000", true),
        ("Tgl Lahir: 29-02-2024", true),
        ("Tgl Lahir: 29-02-2023", false),
        ("Tgl Lahir: 29-02-1900", false),
    ] {
        let (f, _) = one(t, Kind::BirthDate);
        assert_eq!(f.confidence == Confidence::Sedang, ok, "{t}");
    }
}

#[test]
fn birth_value_capped_at_60_chars_and_ends_at_eol() {
    let t = format!("Tgl Lahir: {}\nbaris lain", "z".repeat(100));
    let (_, v) = one(&t, Kind::BirthDate);
    assert_eq!(v.chars().count(), 60);
    let (_, v) = one("Tgl Lahir: 17-08-1990  \nx", Kind::BirthDate);
    assert_eq!(v, "17-08-1990");
}

#[test]
fn birth_needs_separator_and_value() {
    assert!(values("Tgl Lahir 17-08-1990", Kind::BirthDate).is_empty());
    assert!(values("Tgl Lahir:", Kind::BirthDate).is_empty());
    assert!(values("Tempat Lahir: Jakarta", Kind::BirthDate).is_empty());
    assert!(values("Ulang tanggal: 17-08-1990", Kind::BirthDate).is_empty());
}

// ---------- Mixed ----------

#[test]
fn ktp_like_block_finds_each_label_once() {
    let t = "NIK: 3201731508900001\nNama: Budi Santoso\nTempat/Tgl Lahir: Bogor, 15-08-1990\nAlamat: Jl. Mawar No. 1\nRT 001/RW 002\n";
    let v = all(t);
    let kinds: Vec<Kind> = v.iter().map(|f| f.kind).collect();
    assert_eq!(
        kinds,
        [Kind::Nik, Kind::Name, Kind::BirthDate, Kind::Address]
    );
    assert_eq!(js_slice(t, &v[3]), "Jl. Mawar No. 1\nRT 001/RW 002");
}
