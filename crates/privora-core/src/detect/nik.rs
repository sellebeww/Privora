// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Vassel Goleyu
//! NIK candidates.

use super::{Candidate, Sixteen};
use crate::keywords;
use crate::nik::validate_nik;
use crate::types::{Confidence, Kind, ScanOptions, Sensitivity, Validation};

pub(crate) fn detect(text: &str, sixteen: &[Sixteen], opt: &ScanOptions, out: &mut Vec<Candidate>) {
    for s in sixteen {
        let result = validate_nik(&s.digits, opt.reference_date);
        let keyword = keywords::near(text, s.start, keywords::NIK);
        let (confidence, reason) = match (result.is_ok(), keyword) {
            (true, true) => (Confidence::Tinggi, "NIK_STRUKTUR_VALID_KATA_KUNCI"),
            (true, false) => (Confidence::Sedang, "NIK_STRUKTUR_VALID"),
            (false, true) => (Confidence::Rendah, "NIK_STRUKTUR_TIDAK_VALID"),
            (false, false) if opt.sensitivity == Sensitivity::HatiHati => {
                (Confidence::Rendah, "NIK_16_DIGIT_HATI_HATI")
            }
            (false, false) => continue,
        };
        out.push(Candidate {
            kind: Kind::Nik,
            start: s.start,
            end: s.end,
            confidence,
            reason,
            validation: Some(Validation::Nik(result)),
        });
    }
}
