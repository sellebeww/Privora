// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Vassel Goleyu
//! Kartu Keluarga number: 16 digits, KK keyword nearby, valid province. The date part is an
//! issue date and is not validated like a NIK.

use super::{Candidate, Sixteen};
use crate::keywords;
use crate::nik::known_province;
use crate::types::{Confidence, Kind, Validation};

pub(crate) fn detect(text: &str, sixteen: &[Sixteen], out: &mut Vec<Candidate>) {
    for s in sixteen {
        let Some(province) = known_province(&s.digits) else {
            continue;
        };
        if keywords::near(text, s.start, keywords::KK) {
            out.push(Candidate {
                kind: Kind::Kk,
                start: s.start,
                end: s.end,
                confidence: Confidence::Tinggi,
                reason: "KK_KATA_KUNCI_PROVINSI_VALID",
                validation: Some(Validation::Province(province)),
            });
        }
    }
}
