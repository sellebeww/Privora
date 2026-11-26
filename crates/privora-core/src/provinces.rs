// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Vassel Goleyu
//! Province codes for NIK rule R1 (first two digits).
//!
//! The 38 Kemendagri codes, checked on 2026-11-26 against the official Kemendagri dashboard
//! (posyandu.kemendagri.go.id). Note that
//! BPS numbers the Papua provinces differently; NIKs use the Kemendagri codes. Codes of provinces
//! that were later split or renamed are NOT kept.

pub(crate) const PROVINCES: &[(u8, &str)] = &[
    (11, "Aceh"),
    (12, "Sumatera Utara"),
    (13, "Sumatera Barat"),
    (14, "Riau"),
    (15, "Jambi"),
    (16, "Sumatera Selatan"),
    (17, "Bengkulu"),
    (18, "Lampung"),
    (19, "Kepulauan Bangka Belitung"),
    (21, "Kepulauan Riau"),
    (31, "DKI Jakarta"),
    (32, "Jawa Barat"),
    (33, "Jawa Tengah"),
    (34, "DI Yogyakarta"),
    (35, "Jawa Timur"),
    (36, "Banten"),
    (51, "Bali"),
    (52, "Nusa Tenggara Barat"),
    (53, "Nusa Tenggara Timur"),
    (61, "Kalimantan Barat"),
    (62, "Kalimantan Tengah"),
    (63, "Kalimantan Selatan"),
    (64, "Kalimantan Timur"),
    (65, "Kalimantan Utara"),
    (71, "Sulawesi Utara"),
    (72, "Sulawesi Tengah"),
    (73, "Sulawesi Selatan"),
    (74, "Sulawesi Tenggara"),
    (75, "Gorontalo"),
    (76, "Sulawesi Barat"),
    (81, "Maluku"),
    (82, "Maluku Utara"),
    (91, "Papua"),
    (92, "Papua Barat"),
    (93, "Papua Selatan"),
    (94, "Papua Tengah"),
    (95, "Papua Pegunungan"),
    (96, "Papua Barat Daya"),
];

pub(crate) fn is_province(code: u8) -> bool {
    PROVINCES.binary_search_by_key(&code, |&(c, _)| c).is_ok()
}
