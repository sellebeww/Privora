// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Vassel Goleyu
//! Document templates. Written by the same author as the detectors, so results lean optimistic
//! (see docs/EVALUATION.md, limitations).

use privora_core::Kind;
use privora_core::nik::validate_nik;

use crate::rng::Rng;
use crate::{Doc, Gold, Neg, REFERENCE_DATE};

const FIRST: &[&str] = &[
    "Budi", "Siti", "Agus", "Dewi", "Rina", "Joko", "Wulan", "Hendra", "Putri", "Bambang",
    "Lestari", "Eko", "Maya", "Fajar", "Ayu", "Rizki", "Citra", "Dimas", "Nur", "Tri",
];
const LAST: &[&str] = &[
    "Santoso", "Wijaya", "Pratama", "Lestari", "Hidayat", "Saputra", "Kusuma", "Nugroho", "Rahayu",
    "Setiawan", "Gunawan", "Permata", "Susanto", "Utami", "Wibowo", "Maulana",
];
const STREET: &[&str] = &[
    "Mawar",
    "Melati",
    "Kenanga",
    "Cendana",
    "Anggrek",
    "Dahlia",
    "Flamboyan",
    "Kamboja",
    "Sudirman",
    "Diponegoro",
];
const AREA: &[&str] = &[
    "Sukamaju",
    "Cibeunying",
    "Karangasem",
    "Tegalrejo",
    "Kebonsari",
    "Mekarjaya",
    "Sidomulyo",
    "Banjarsari",
];
const CITY: &[&str] = &[
    "Bandung",
    "Surabaya",
    "Medan",
    "Makassar",
    "Semarang",
    "Bogor",
    "Malang",
    "Denpasar",
    "Palembang",
    "Yogyakarta",
];
const MONTHS: &[&str] = &[
    "Januari",
    "Februari",
    "Maret",
    "April",
    "Mei",
    "Juni",
    "Juli",
    "Agustus",
    "September",
    "Oktober",
    "November",
    "Desember",
];
const DOMAINS: &[&str] = &[
    "contoh.id",
    "example.com",
    "surel.co.id",
    "mail.example.org",
    "contoh.co.id",
];
const PROVINCES: &[&str] = &[
    "11", "12", "13", "14", "15", "16", "17", "18", "19", "21", "31", "32", "33", "34", "35", "36",
    "51", "52", "53", "61", "62", "63", "64", "71", "72", "73", "74", "75", "76", "81", "82", "91",
    "92", "93", "94", "95", "96",
];
const OPERATORS: &[&str] = &[
    "811", "812", "813", "821", "822", "851", "852", "857", "877", "878", "895", "896",
];

pub const TEMPLATES: [&str; 8] = [
    "form_ktp",
    "surat_pernyataan",
    "cv",
    "ekspor_chat",
    "utas_email",
    "csv",
    "faktur",
    "catatan_rapat",
];

/// Text builder that tracks UTF-16 offsets.
struct B {
    text: String,
    units: usize,
    gold: Vec<Gold>,
    neg: Vec<Neg>,
}

impl B {
    fn new() -> Self {
        B {
            text: String::new(),
            units: 0,
            gold: vec![],
            neg: vec![],
        }
    }
    fn s(&mut self, t: &str) -> &mut Self {
        self.text.push_str(t);
        self.units += t.encode_utf16().count();
        self
    }
    fn gold(&mut self, kind: Kind, v: &str, labeled: bool) -> &mut Self {
        let start = self.units;
        self.s(v);
        self.gold.push(Gold {
            kind,
            start,
            end: self.units,
            labeled,
        });
        self
    }
    fn neg(&mut self, category: &'static str, v: &str) -> &mut Self {
        let start = self.units;
        self.s(v);
        self.neg.push(Neg {
            category,
            start,
            end: self.units,
        });
        self
    }
}

// ---------- value generators ----------

fn name(r: &mut Rng) -> String {
    let n = if r.chance(25) {
        format!("{} {} {}", r.pick(FIRST), r.pick(FIRST), r.pick(LAST))
    } else {
        format!("{} {}", r.pick(FIRST), r.pick(LAST))
    };
    if r.chance(20) { n.to_uppercase() } else { n }
}

/// 16 digits with a structure that passes R1 to R4 at the reference date.
fn nik(r: &mut Rng) -> String {
    loop {
        let age = r.range(18, 80) as i32;
        let year = REFERENCE_DATE.year - age;
        let (month, day) = (r.range(1, 12), r.range(1, 28));
        let day = if r.chance(50) { day + 40 } else { day };
        let s = format!(
            "{}{:02}{:02}{:02}{:02}{:02}{:04}",
            r.pick(PROVINCES),
            r.range(1, 40),
            r.range(1, 40),
            day,
            month,
            year % 100,
            r.range(1, 9999)
        );
        if validate_nik(&s, REFERENCE_DATE).is_ok() {
            return s;
        }
    }
}

fn group(s: &str, size: usize, sep: &str) -> String {
    s.as_bytes()
        .chunks(size)
        .map(|c| String::from_utf8_lossy(c).into_owned())
        .collect::<Vec<_>>()
        .join(sep)
}

fn phone(r: &mut Rng) -> String {
    let len = r.range(6, 8) as usize;
    let rest = r.digits(len);
    let n = format!("{}{}", r.pick(OPERATORS), rest);
    match r.range(0, 4) {
        0 => format!("0{n}"),
        1 => format!("0{}-{}-{}", &n[..3], &n[3..7], &n[7..]),
        2 => format!("+62 {} {} {}", &n[..3], &n[3..7], &n[7..]),
        3 => format!("62{n}"),
        _ => format!("0{} {} {}", &n[..3], &n[3..7], &n[7..]),
    }
}

fn email(r: &mut Rng, who: &str) -> String {
    let local = who
        .to_lowercase()
        .replace(' ', if r.chance(50) { "." } else { "_" });
    let suffix = if r.chance(30) {
        r.range(1, 99).to_string()
    } else {
        String::new()
    };
    format!("{local}{suffix}@{}", r.pick(DOMAINS))
}

fn npwp(r: &mut Rng) -> String {
    format!(
        "{}.{}.{}.{}-{}.{}",
        r.digits(2),
        r.digits(3),
        r.digits(3),
        r.digits(1),
        r.digits(3),
        r.digits(3)
    )
}

fn luhn_ok(s: &str) -> bool {
    let mut sum = 0;
    for (i, c) in s.chars().rev().enumerate() {
        let mut d = c.to_digit(10).unwrap_or(0);
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

/// 16 digit card number that passes Luhn.
fn card(r: &mut Rng) -> String {
    let prefix = r.pick(&["4", "51", "52", "53", "35", "6011"]);
    let body = format!("{prefix}{}", r.digits(15 - prefix.len()));
    let check = (0..10)
        .find(|d| luhn_ok(&format!("{body}{d}")))
        .unwrap_or(0);
    format!("{body}{check}")
}

fn card_fmt(r: &mut Rng) -> String {
    let c = card(r);
    match r.range(0, 2) {
        0 => c,
        1 => group(&c, 4, " "),
        _ => group(&c, 4, "-"),
    }
}

fn birth(r: &mut Rng) -> String {
    let (d, m, y) = (r.range(1, 28), r.range(1, 12), r.range(1950, 2005));
    let place = r.pick(CITY);
    if r.chance(50) {
        format!("{place}, {d:02}-{m:02}-{y}")
    } else {
        format!("{place}, {d} {} {y}", MONTHS[m as usize - 1])
    }
}

fn addr1(r: &mut Rng) -> String {
    format!("Jl. {} No. {}", r.pick(STREET), r.range(1, 120))
}

fn addr2(r: &mut Rng) -> String {
    format!(
        "RT {:03}/RW {:03}, Kel. {}, Kec. {}, {}",
        r.range(1, 20),
        r.range(1, 12),
        r.pick(AREA),
        r.pick(AREA),
        r.pick(CITY)
    )
}

/// An address value as it would appear after `Alamat:`. Roughly: one line, two lines, or very long.
fn address(r: &mut Rng) -> String {
    match r.range(0, 99) {
        0..=54 => format!("{}, {}", addr1(r), addr2(r)),
        55..=94 => format!("{}\n{}", addr1(r), addr2(r)),
        _ => format!(
            "{}, Perumahan {} Blok {}, Gang {} Komplek {}, Dusun {}, Desa {}, Tahap {}, {}",
            addr1(r),
            r.pick(AREA),
            r.range(1, 30),
            r.pick(STREET),
            r.pick(AREA),
            r.pick(AREA),
            r.pick(AREA),
            r.range(1, 9),
            addr2(r)
        ),
    }
}

// ---------- hard negatives ----------

fn negative(r: &mut Rng, b: &mut B) {
    match r.range(0, 12) {
        0 => {
            b.s("Nomor resi: ");
            let v = format!("JP{}", r.digits(10));
            b.neg("resi", &v);
        }
        1 => {
            b.s("ID Transaksi: ");
            let v = r.digits(16);
            b.neg("acak16", &v);
        }
        2 => {
            b.s("Kode batch ");
            let v = group(&r.digits(16), 4, "-");
            b.neg("acak16", &v);
        }
        3 => {
            b.s("Ref ");
            let v = r.digits(16);
            b.neg("acak16", &v);
        }
        4 => {
            b.s("Dikirim pada ");
            let v = format!(
                "2026-11-{:02} {:02}:{:02}:{:02}",
                r.range(1, 25),
                r.range(0, 23),
                r.range(0, 59),
                r.range(0, 59)
            );
            b.neg("cap_waktu", &v);
        }
        5 => {
            b.s("Kode produk: ");
            let v = format!("SKU-{}-{}-{}", r.digits(4), r.digits(4), r.digits(4));
            b.neg("kode_produk", &v);
        }
        6 => {
            b.s("Versi aplikasi ");
            let v = format!(
                "v{}.{}.{}.{}",
                r.range(1, 9),
                r.range(0, 30),
                r.range(0, 30),
                r.range(100, 9999)
            );
            b.neg("versi", &v);
        }
        7 => {
            b.s("Tanggal terbit: ");
            let v = format!(
                "{:02}-{:02}-{}",
                r.range(1, 28),
                r.range(1, 12),
                r.range(2015, 2026)
            );
            b.neg("tanggal", &v);
        }
        8 => {
            b.s("Mohon siapkan ");
            b.neg("kata_nik_tanpa_nomor", "NIK");
            b.s(" dan fotokopi KTP untuk verifikasi");
        }
        9 => {
            b.s("git config user.name x; remote ");
            b.neg("email_kode", "git@github.com:contoh-org/repo.git");
        }
        10 => {
            b.s("Nomor tidak valid: ");
            let v = format!("{}{}", nik(r), r.range(0, 9));
            b.neg("melewati_batas", &v);
        }
        11 => {
            b.s("Nomor panjang ");
            let v = r.digits(19);
            b.neg("melewati_batas", &v);
        }
        _ => {
            b.s("Surat No. ");
            let v = format!("{:03}/SP/XI/2026", r.range(1, 400));
            b.neg("nomor_surat", &v);
        }
    }
    b.s("\n");
}

fn some_negatives(r: &mut Rng, b: &mut B, lo: u64, hi: u64) {
    for _ in 0..r.range(lo, hi) {
        negative(r, b);
    }
}

// ---------- templates ----------

fn labeled_field(r: &mut Rng, b: &mut B, label: &str, kind: Kind, v: &str) {
    let sep = r.pick(&[": ", " : ", ":", " = "]);
    let l = if r.chance(15) {
        label.to_uppercase()
    } else {
        label.to_string()
    };
    b.s(&l).s(sep).gold(kind, v, true).s("\n");
}

fn form_ktp(r: &mut Rng, b: &mut B) {
    b.s("FORMULIR DATA DIRI\n\n");
    let who = name(r);
    let nik_label = r.pick(&[
        "NIK",
        "NIK",
        "No. KTP",
        "Nomor Induk Kependudukan",
        "No. Identitas",
    ]);
    let n = nik(r);
    let n = if r.chance(25) {
        if r.chance(50) {
            group(&n, 4, " ")
        } else {
            format!("{}-{}-{}", &n[..6], &n[6..12], &n[12..])
        }
    } else {
        n
    };
    labeled_field(r, b, nik_label, Kind::Nik, &n);
    let l = r.pick(&["Nama", "Nama Lengkap", "Nama Pemohon"]);
    labeled_field(r, b, l, Kind::Name, &who);
    let label = r.pick(&["Tempat/Tgl Lahir", "Tempat, Tanggal Lahir", "Tgl Lahir"]);
    let v = birth(r);
    let v = if label == "Tgl Lahir" {
        v.split(", ").nth(1).unwrap_or(&v).to_string()
    } else {
        v
    };
    labeled_field(r, b, label, Kind::BirthDate, &v);
    let a = address(r);
    labeled_field(r, b, "Alamat", Kind::Address, &a);
    if r.chance(60) {
        let kk = format!("{}{}", r.pick(PROVINCES), r.digits(14));
        let l = r.pick(&["No. KK", "Kartu Keluarga"]);
        labeled_field(r, b, l, Kind::Kk, &kk);
    }
    if r.chance(60) {
        let (l, p) = (r.pick(&["Telp", "HP", "No. WhatsApp"]), phone(r));
        labeled_field(r, b, l, Kind::Phone, &p);
    }
    if r.chance(50) {
        let e = email(r, &who);
        labeled_field(r, b, "Email", Kind::Email, &e);
    }
    if r.chance(40) {
        {
            let v = npwp(r);
            labeled_field(r, b, "NPWP", Kind::Npwp, &v);
        }
    }
    b.s("Pekerjaan: Karyawan Swasta\n");
    some_negatives(r, b, 1, 3);
}

fn surat_pernyataan(r: &mut Rng, b: &mut B) {
    b.s("SURAT PERNYATAAN\n\nYang bertanda tangan di bawah ini:\n");
    let who = name(r);
    labeled_field(r, b, "Nama", Kind::Name, &who);
    {
        let v = nik(r);
        labeled_field(r, b, "NIK", Kind::Nik, &v);
    }
    let a = address(r);
    labeled_field(r, b, "Alamat", Kind::Address, &a);
    {
        let v = phone(r);
        labeled_field(r, b, "No. HP", Kind::Phone, &v);
    }
    b.s("\nDengan ini menyatakan bahwa data di atas benar. Surat ini dibuat oleh ");
    b.gold(Kind::Name, &who, false);
    b.s(" tanpa paksaan.\n");
    if r.chance(50) {
        b.s("Bukti pembayaran dikirim ke ")
            .gold(Kind::Email, &email(r, &who), false)
            .s(".\n");
    }
    some_negatives(r, b, 1, 3);
    b.s(&format!("\n{}, 25 November 2026\n", r.pick(CITY)));
}

fn cv(r: &mut Rng, b: &mut B) {
    let who = name(r);
    b.gold(Kind::Name, &who, false).s("\nSoftware Engineer\n");
    b.s("Email: ")
        .gold(Kind::Email, &email(r, &who), true)
        .s(" | HP ")
        .gold(Kind::Phone, &phone(r), true)
        .s("\n");
    let v = birth(r);
    labeled_field(r, b, "Tempat/Tgl Lahir", Kind::BirthDate, &v);
    let a = format!("{}, {}", addr1(r), addr2(r));
    labeled_field(r, b, "Alamat", Kind::Address, &a);
    b.s("\nPengalaman\n2018 - 2022  Backend Engineer, PT Contoh Maju (Python 3.12, Rust 1.99)\n2022 - sekarang  Tech Lead\n");
    b.s("Pendidikan\nS1 Informatika, lulus Juli 2018\n");
    some_negatives(r, b, 1, 2);
}

fn ekspor_chat(r: &mut Rng, b: &mut B) {
    let (p, q) = (name(r), name(r));
    for _ in 0..r.range(6, 12) {
        let who = if r.chance(50) { &p } else { &q };
        let ts = format!(
            "[{:02}/11/26 {:02}:{:02}] ",
            r.range(1, 25),
            r.range(0, 23),
            r.range(0, 59)
        );
        b.neg("cap_waktu", ts.trim_end()).s(" ");
        b.gold(Kind::Name, who, false).s(": ");
        match r.range(0, 9) {
            0 => {
                b.s("nik aku ").gold(Kind::Nik, &nik(r), true);
            }
            1 => {
                b.s("coba cek ")
                    .gold(Kind::Nik, &nik(r), false)
                    .s(" itu bener?");
            }
            2 => {
                b.s("wa aku ").gold(Kind::Phone, &phone(r), true);
            }
            3 => {
                b.s("kartu kredit gue ")
                    .gold(Kind::Card, &card_fmt(r), true);
            }
            4 => {
                b.s("email: ").gold(Kind::Email, &email(r, who), true);
            }
            5 => {
                b.s("npwp ").gold(Kind::Npwp, &npwp(r), true);
            }
            6 => {
                b.s("oke siap \u{1F600} ditunggu ya, nanti kabari lagi");
            }
            7 => {
                negative_inline(r, b);
            }
            _ => {
                b.s("sudah transfer, cek mutasi ya \u{1F44D} caf\u{e9} tadi");
            }
        }
        b.s("\n");
    }
}

/// A negative without the trailing newline (used inside other lines).
fn negative_inline(r: &mut Rng, b: &mut B) {
    let mut tmp = B::new();
    tmp.units = b.units;
    negative(r, &mut tmp);
    let text = tmp.text.trim_end_matches('\n').to_string();
    b.text.push_str(&text);
    b.units += text.encode_utf16().count();
    b.neg.extend(tmp.neg);
}

fn utas_email(r: &mut Rng, b: &mut B) {
    for _ in 0..r.range(2, 3) {
        let (p, q) = (name(r), name(r));
        b.s("Dari: ")
            .gold(Kind::Name, &p, false)
            .s(" <")
            .gold(Kind::Email, &email(r, &p), false)
            .s(">\n");
        b.s("Kepada: ")
            .gold(Kind::Name, &q, false)
            .s(" <")
            .gold(Kind::Email, &email(r, &q), false)
            .s(">\n");
        b.s("Perihal: Dokumen pendaftaran\n\nSelamat pagi,\n");
        b.s("Berikut data saya untuk keperluan administrasi.\n");
        if r.chance(60) {
            b.s("NIK: ").gold(Kind::Nik, &nik(r), true).s("\n");
        }
        if r.chance(40) {
            b.s("NPWP: ").gold(Kind::Npwp, &npwp(r), true).s("\n");
        }
        some_negatives(r, b, 0, 2);
        b.s("\nSalam,\n")
            .gold(Kind::Name, &p, false)
            .s("\nTelp: ")
            .gold(Kind::Phone, &phone(r), true)
            .s("\n\n> ");
    }
    b.s("pesan sebelumnya\n");
}

fn csv(r: &mut Rng, b: &mut B) {
    b.s("nama,nik,telepon,email,tgl_lahir,kode_pesanan\n");
    for _ in 0..r.range(5, 10) {
        let who = name(r);
        b.gold(Kind::Name, &who, false).s(",");
        b.gold(Kind::Nik, &nik(r), false).s(",");
        b.gold(Kind::Phone, &phone(r), false).s(",");
        b.gold(Kind::Email, &email(r, &who), false).s(",");
        b.s(&format!(
            "{:02}-{:02}-{},",
            r.range(1, 28),
            r.range(1, 12),
            r.range(1950, 2005)
        ));
        b.neg("acak16", &r.digits(16)).s("\n");
    }
}

fn faktur(r: &mut Rng, b: &mut B) {
    b.s(&format!(
        "FAKTUR\nNo. INV/2026/11/{:04}\nTanggal: {:02}-11-2026\n",
        r.range(1, 999),
        r.range(1, 25)
    ));
    let who = name(r);
    labeled_field(r, b, "Nama", Kind::Name, &who);
    {
        let v = npwp(r);
        labeled_field(r, b, "NPWP", Kind::Npwp, &v);
    }
    let a = format!("{}, {}", addr1(r), addr2(r));
    labeled_field(r, b, "Alamat", Kind::Address, &a);
    for _ in 0..r.range(2, 4) {
        b.s("Item ").neg(
            "kode_produk",
            &format!("SKU-{}-{}-{}", r.digits(4), r.digits(4), r.digits(4)),
        );
        b.s(&format!(
            "  Rp {}.{:03}.000\n",
            r.range(1, 20),
            r.range(0, 999)
        ));
    }
    b.s("Dibayar dengan kartu kredit ")
        .gold(Kind::Card, &card_fmt(r), true)
        .s("\n");
    some_negatives(r, b, 1, 2);
}

fn catatan_rapat(r: &mut Rng, b: &mut B) {
    b.s(&format!(
        "Catatan rapat {:02}-11-2026, pukul {:02}:{:02}\n",
        r.range(1, 25),
        r.range(8, 16),
        r.range(0, 59)
    ));
    b.s("Peserta hadir: ");
    for i in 0..r.range(2, 4) {
        if i > 0 {
            b.s(", ");
        }
        b.gold(Kind::Name, &name(r), false);
    }
    b.s("\n- Rilis v2.4.1 ditunda sampai minggu depan\n- Peserta menyiapkan ");
    b.neg("kata_nik_tanpa_nomor", "NIK");
    b.s(" untuk akun baru\n");
    if r.chance(50) {
        b.s("- Hubungi ")
            .gold(Kind::Name, &name(r), false)
            .s(" lewat ")
            .gold(Kind::Email, &email(r, "panitia"), false)
            .s("\n");
    }
    if r.chance(40) {
        b.s("- Kontak darurat: ")
            .gold(Kind::Phone, &phone(r), true)
            .s("\n");
    }
    some_negatives(r, b, 1, 3);
    b.s("Atas nama: ").gold(Kind::Name, &name(r), true).s("\n");
}

/// Document number `index` of the split with the given seed. Pure function of its arguments.
pub fn doc(seed: u64, split: &'static str, index: usize) -> Doc {
    let mut r = Rng::new(seed, index as u64);
    let template = TEMPLATES[index % TEMPLATES.len()];
    let mut b = B::new();
    match template {
        "form_ktp" => form_ktp(&mut r, &mut b),
        "surat_pernyataan" => surat_pernyataan(&mut r, &mut b),
        "cv" => cv(&mut r, &mut b),
        "ekspor_chat" => ekspor_chat(&mut r, &mut b),
        "utas_email" => utas_email(&mut r, &mut b),
        "csv" => csv(&mut r, &mut b),
        "faktur" => faktur(&mut r, &mut b),
        _ => catatan_rapat(&mut r, &mut b),
    }
    Doc {
        id: format!("{split}-{index:04}"),
        split,
        template,
        text: b.text,
        gold: b.gold,
        neg: b.neg,
    }
}

pub fn corpus(seed: u64, split: &'static str, count: usize) -> Vec<Doc> {
    (0..count).map(|i| doc(seed, split, i)).collect()
}
