// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Vassel Goleyu
//! Structured detectors. Each submodule returns candidates (byte ranges) before overlap
//! resolution. All matching is ASCII-only, so every range edge is a char boundary.

pub(crate) mod card;
pub(crate) mod email;
pub(crate) mod kk;
pub(crate) mod labels;
pub(crate) mod nik;
pub(crate) mod npwp;
pub(crate) mod phone;

use crate::types::{Confidence, Kind, Validation};

/// A detector hit in byte offsets, before UTF-16 conversion.
#[derive(Clone, Debug)]
pub(crate) struct Candidate {
    pub kind: Kind,
    pub start: usize,
    pub end: usize,
    pub confidence: Confidence,
    pub reason: &'static str,
    pub validation: Option<Validation>,
}

/// A 16 digit run in one of the accepted shapes, shared by the NIK, KK and NPWP detectors.
#[derive(Clone, Debug)]
pub(crate) struct Sixteen {
    pub start: usize,
    pub end: usize,
    pub digits: String,
}

pub(crate) fn digit_at(b: &[u8], i: usize) -> bool {
    b.get(i).is_some_and(u8::is_ascii_digit)
}

/// `i` is a digit and the byte before it is not.
pub(crate) fn run_start(b: &[u8], i: usize) -> bool {
    digit_at(b, i) && i.checked_sub(1).is_none_or(|p| !digit_at(b, p))
}

/// Number of consecutive ASCII digits starting at `i`.
pub(crate) fn run_len(b: &[u8], i: usize) -> usize {
    b.get(i..)
        .map_or(0, |s| s.iter().take_while(|c| c.is_ascii_digit()).count())
}

/// Single separator between groups: space, dot or hyphen.
pub(crate) fn is_sep(c: u8) -> bool {
    matches!(c, b' ' | b'.' | b'-')
}

/// Match digit groups of exactly `lens` digits joined by one repeated separator. `i` must be a
/// run start. Returns the end offset. Each group is a maximal digit run, so no digit touches
/// the match from outside.
pub(crate) fn groups(b: &[u8], i: usize, lens: &[usize]) -> Option<usize> {
    let mut pos = i;
    let mut sep: Option<u8> = None;
    for (k, &len) in lens.iter().enumerate() {
        if run_len(b, pos) != len {
            return None;
        }
        pos = pos.saturating_add(len);
        if k.saturating_add(1) < lens.len() {
            let s = *b.get(pos)?;
            if !is_sep(s) || sep.is_some_and(|x| x != s) {
                return None;
            }
            sep = Some(s);
            pos = pos.saturating_add(1);
        }
    }
    Some(pos)
}

pub(crate) fn digits_of(b: &[u8], start: usize, end: usize) -> String {
    b.get(start..end)
        .unwrap_or_default()
        .iter()
        .filter(|c| c.is_ascii_digit())
        .map(|c| char::from(*c))
        .collect()
}

/// All 16 digit runs: contiguous, `6-6-4` and `4-4-4-4`.
pub(crate) fn sixteen_digit_runs(text: &str) -> Vec<Sixteen> {
    let b = text.as_bytes();
    let mut out = Vec::new();
    for i in 0..b.len() {
        if !run_start(b, i) {
            continue;
        }
        let end = match run_len(b, i) {
            16 => Some(i.saturating_add(16)),
            6 => groups(b, i, &[6, 6, 4]),
            4 => groups(b, i, &[4, 4, 4, 4]),
            _ => None,
        };
        if let Some(end) = end {
            out.push(Sixteen {
                start: i,
                end,
                digits: digits_of(b, i, end),
            });
        }
    }
    out
}
