// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Vassel Goleyu
//! Overlap resolution. Works on byte ranges before the UTF-16 conversion.
//!
//! Candidates are ranked by basis (keyword match > validated structure > heuristic), then by
//! longer range, then by a fixed kind order, then by position. They are then "painted" in that
//! order: the part of a candidate not yet covered by a better one is kept. A candidate that is
//! only partly covered survives as remainders, so resolution never uncovers text that some
//! detector had marked (this is the leak guard); remainders are trimmed of edge whitespace.

use std::cmp::Reverse;
use std::collections::BTreeMap;

use crate::detect::Candidate;
use crate::types::{Confidence, Kind};

/// Reason code of a remainder left after a better candidate took part of the range.
pub(crate) const REMAINDER: &str = "SISA_TUMPANG_TINDIH";

#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
enum Basis {
    Heuristic,
    Structure,
    Keyword,
}

fn basis(c: &Candidate) -> Basis {
    match c.kind {
        Kind::Name | Kind::Address | Kind::BirthDate => Basis::Heuristic,
        _ if c.reason == "NIK_16_DIGIT_HATI_HATI" => Basis::Heuristic,
        _ if c.reason.contains("KATA_KUNCI") || c.reason == "NIK_STRUKTUR_TIDAK_VALID" => {
            Basis::Keyword
        }
        _ => Basis::Structure,
    }
}

/// Fixed tie-break order. NPWP and KK come before NIK because their keyword is the more
/// specific claim on a 16 digit number (NPWP rule c). Phone comes before Card: a 13 digit
/// `62...` number that happens to pass Luhn is far more likely a phone number (dev seed, D-23).
const fn kind_rank(k: Kind) -> u8 {
    match k {
        Kind::Npwp => 0,
        Kind::Kk => 1,
        Kind::Nik => 2,
        Kind::Phone => 3,
        Kind::Card => 4,
        Kind::Email => 5,
        Kind::BirthDate => 6,
        Kind::Name => 7,
        Kind::Address => 8,
    }
}

pub(crate) fn resolve(text: &str, mut c: Vec<Candidate>) -> Vec<Candidate> {
    c.retain(|x| x.start < x.end);
    c.sort_by_key(|x| {
        (
            Reverse(basis(x)),
            Reverse(x.end.saturating_sub(x.start)),
            kind_rank(x.kind),
            Reverse(x.confidence),
            x.start,
            x.end,
            x.reason,
        )
    });
    // accepted, disjoint ranges: start -> end
    let mut taken: BTreeMap<usize, usize> = BTreeMap::new();
    let mut out: Vec<Candidate> = Vec::with_capacity(c.len());
    for cand in c {
        let gaps = free_pieces(&taken, cand.start, cand.end);
        let whole = gaps.len() == 1 && gaps.first() == Some(&(cand.start, cand.end));
        for (a, b) in gaps {
            let piece = if whole {
                cand.clone()
            } else {
                let (a, b) = trim(text, a, b);
                if a >= b {
                    continue;
                }
                Candidate {
                    start: a,
                    end: b,
                    confidence: Confidence::Rendah,
                    reason: REMAINDER,
                    validation: None,
                    ..cand.clone()
                }
            };
            taken.insert(piece.start, piece.end);
            out.push(piece);
        }
    }
    out.sort_by_key(|x| (x.start, x.end));
    out
}

/// The sub-ranges of `[s, e)` not covered by `taken`, left to right.
fn free_pieces(taken: &BTreeMap<usize, usize>, s: usize, e: usize) -> Vec<(usize, usize)> {
    let mut pos = s;
    let mut pieces = Vec::new();
    // a range that starts before `s` but reaches into it
    if let Some((_, &end)) = taken.range(..=s).next_back() {
        pos = pos.max(end);
    }
    for (&ts, &te) in taken.range(s..e) {
        if ts > pos {
            pieces.push((pos, ts));
        }
        pos = pos.max(te);
    }
    if pos < e {
        pieces.push((pos, e));
    }
    pieces
}

/// Shrink `[a, b)` past whitespace at both ends. Falls back to the input if the range is not
/// on char boundaries (cannot happen with this crate's detectors).
fn trim(text: &str, a: usize, b: usize) -> (usize, usize) {
    let Some(s) = text.get(a..b) else {
        return (a, b);
    };
    let left = s.len().saturating_sub(s.trim_start().len());
    let t = s.trim();
    (
        a.saturating_add(left),
        a.saturating_add(left).saturating_add(t.len()),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn free_pieces_cases() {
        let t: BTreeMap<usize, usize> = [(2, 4), (6, 8)].into();
        assert_eq!(free_pieces(&t, 0, 10), vec![(0, 2), (4, 6), (8, 10)]);
        assert_eq!(free_pieces(&t, 3, 7), vec![(4, 6)]);
        assert_eq!(free_pieces(&t, 2, 4), vec![]);
        assert_eq!(free_pieces(&t, 8, 9), vec![(8, 9)]);
    }

    #[test]
    fn every_reason_code_has_a_basis() {
        for (r, k, want) in [
            ("NIK_STRUKTUR_VALID_KATA_KUNCI", Kind::Nik, Basis::Keyword),
            ("NIK_STRUKTUR_TIDAK_VALID", Kind::Nik, Basis::Keyword),
            ("NIK_STRUKTUR_VALID", Kind::Nik, Basis::Structure),
            ("NIK_16_DIGIT_HATI_HATI", Kind::Nik, Basis::Heuristic),
            ("KK_KATA_KUNCI_PROVINSI_VALID", Kind::Kk, Basis::Keyword),
            ("NPWP_FORMAT_BERFORMAT", Kind::Npwp, Basis::Structure),
            ("NPWP_15_DIGIT_KATA_KUNCI", Kind::Npwp, Basis::Keyword),
            ("NPWP_16_DIGIT_KATA_KUNCI", Kind::Npwp, Basis::Keyword),
            ("TELEPON_KATA_KUNCI", Kind::Phone, Basis::Keyword),
            ("TELEPON_FORMAT", Kind::Phone, Basis::Structure),
            ("EMAIL_FORMAT", Kind::Email, Basis::Structure),
            ("KARTU_LUHN_KATA_KUNCI", Kind::Card, Basis::Keyword),
            ("KARTU_LUHN", Kind::Card, Basis::Structure),
            ("NAMA_BERLABEL", Kind::Name, Basis::Heuristic),
            ("TGL_LAHIR_FORMAT_VALID", Kind::BirthDate, Basis::Heuristic),
        ] {
            let c = Candidate {
                kind: k,
                start: 0,
                end: 1,
                confidence: Confidence::Rendah,
                reason: r,
                validation: None,
            };
            assert!(basis(&c) == want, "{r}");
        }
    }
}
