// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Vassel Goleyu
//! NPWP: (a) formatted `XX.XXX.XXX.X-XXX.XXX`, (b) 15 digits with keyword, (c) 16 digits with
//! keyword (new format, beats NIK).

use super::{Candidate, Sixteen, run_len, run_start};
use crate::keywords;
use crate::types::{Confidence, Kind};

const LENS: [usize; 6] = [2, 3, 3, 1, 3, 3];
const SEPS: [u8; 5] = *b"...-.";

fn formatted_end(b: &[u8], i: usize) -> Option<usize> {
    let mut pos = i;
    for (k, &len) in LENS.iter().enumerate() {
        if run_len(b, pos) != len {
            return None;
        }
        pos = pos.saturating_add(len);
        if let Some(&sep) = SEPS.get(k) {
            if *b.get(pos)? != sep {
                return None;
            }
            pos = pos.saturating_add(1);
        }
    }
    Some(pos)
}

pub(crate) fn detect(text: &str, sixteen: &[Sixteen], out: &mut Vec<Candidate>) {
    let b = text.as_bytes();
    for i in 0..b.len() {
        if !run_start(b, i) {
            continue;
        }
        if let Some(end) = formatted_end(b, i) {
            out.push(Candidate {
                kind: Kind::Npwp,
                start: i,
                end,
                confidence: Confidence::Tinggi,
                reason: "NPWP_FORMAT_BERFORMAT",
                validation: None,
            });
        } else if run_len(b, i) == 15 && keywords::near(text, i, keywords::NPWP) {
            out.push(Candidate {
                kind: Kind::Npwp,
                start: i,
                end: i.saturating_add(15),
                confidence: Confidence::Sedang,
                reason: "NPWP_15_DIGIT_KATA_KUNCI",
                validation: None,
            });
        }
    }
    for s in sixteen {
        if keywords::near(text, s.start, keywords::NPWP) {
            out.push(Candidate {
                kind: Kind::Npwp,
                start: s.start,
                end: s.end,
                confidence: Confidence::Tinggi,
                reason: "NPWP_16_DIGIT_KATA_KUNCI",
                validation: None,
            });
        }
    }
}
