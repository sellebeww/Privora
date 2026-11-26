// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Vassel Goleyu
#![forbid(unsafe_code)]
#![cfg_attr(test, allow(clippy::arithmetic_side_effects))]
//! Privora core: pure-Rust detection engine. Types, UTF-16 offsets, the NIK validator, structured
//! and label detectors, overlap resolution (`scan`), redaction, tokenisation and restore.

mod detect;
pub mod keywords;
pub mod nik;
pub mod offsets;
mod provinces;
mod redact;
mod resolve;
mod tokenize;
mod types;

use std::borrow::Cow;
use std::cmp::Reverse;

pub use redact::{RedactError, RedactStyle, Span, find_all, redact};
pub use tokenize::{
    Flag, RestoreMode, RestoreReport, TokenMap, TokenizeError, Tokenized, restore, tokenize,
};
pub use types::{Confidence, Date, Finding, Kind, ScanOptions, Sensitivity, Validation};

use detect::Candidate;
use offsets::Utf16Map;

/// Name reported by the engine, used by the wasm smoke test.
pub fn engine_name() -> &'static str {
    "privora-core"
}

/// Length of `s` in UTF-16 code units, the unit of every offset in the public API.
pub fn utf16_len(s: &str) -> usize {
    s.encode_utf16().count()
}

/// Typographic spaces and hyphens (no-break, figure, thin) are read as the plain ones. Each is
/// one UTF-16 unit, like its replacement, so offsets in the result also hold for the input.
fn plain(text: &str) -> Cow<'_, str> {
    let space = |c| matches!(c, '\u{a0}' | '\u{2007}' | '\u{2009}' | '\u{202f}');
    let hyphen = |c| matches!(c, '\u{2010}' | '\u{2011}');
    if !text.contains(|c| space(c) || hyphen(c)) {
        return Cow::Borrowed(text);
    }
    Cow::Owned(
        text.chars()
            .map(|c| match c {
                c if space(c) => ' ',
                c if hyphen(c) => '-',
                c => c,
            })
            .collect(),
    )
}

fn structured(text: &str, options: &ScanOptions) -> Vec<Candidate> {
    let sixteen = detect::sixteen_digit_runs(text);
    let mut c: Vec<Candidate> = Vec::new();
    detect::nik::detect(text, &sixteen, options, &mut c);
    detect::kk::detect(text, &sixteen, &mut c);
    detect::npwp::detect(text, &sixteen, &mut c);
    detect::phone::detect(text, &mut c);
    detect::email::detect(text, &mut c);
    detect::card::detect(text, &mut c);
    c
}

fn to_findings(text: &str, c: Vec<Candidate>, flags: Vec<bool>) -> Vec<Finding> {
    let map = Utf16Map::new(text);
    c.into_iter()
        .zip(flags)
        .map(|(x, overlaps)| Finding {
            kind: x.kind,
            start: map.to_utf16(x.start),
            end: map.to_utf16(x.end),
            confidence: x.confidence,
            reason: x.reason,
            validation: x.validation,
            overlaps,
        })
        .collect()
}

/// Run every structured detector (NIK, KK, NPWP, phone, email, card). The result is sorted by
/// `start` (then longer range first, then kind) and is deterministic. Candidates are NOT
/// resolved: intersecting ones stay and carry `overlaps = true`. Use [`scan`] for the final list.
/// Offsets are UTF-16 code units, `end` exclusive.
pub fn scan_structured(text: &str, options: &ScanOptions) -> Vec<Finding> {
    let text = &*plain(text);
    let mut c = structured(text, options);
    c.sort_by_key(|x| (x.start, Reverse(x.end), x.kind));

    let mut max_end = 0usize;
    let flags: Vec<bool> = c
        .iter()
        .enumerate()
        .map(|(i, cur)| {
            let after_earlier = cur.start < max_end;
            let before_later = c
                .get(i.saturating_add(1))
                .is_some_and(|n| n.start < cur.end);
            max_end = max_end.max(cur.end);
            after_earlier || before_later
        })
        .collect();
    to_findings(text, c, flags)
}

/// The full engine: structured detectors plus label heuristics, overlaps resolved. The
/// result is sorted by `start`, deterministic, and no two findings intersect.
pub fn scan(text: &str, options: &ScanOptions) -> Vec<Finding> {
    let text = &*plain(text);
    let mut c = structured(text, options);
    detect::labels::detect(text, &mut c);
    let c = resolve::resolve(text, c);
    let flags = vec![false; c.len()];
    to_findings(text, c, flags)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn engine_name_is_stable() {
        assert_eq!(engine_name(), "privora-core");
    }

    #[test]
    fn utf16_len_counts_code_units() {
        assert_eq!(utf16_len(""), 0);
        assert_eq!(utf16_len("abc"), 3);
        assert_eq!(utf16_len("é"), 1); // BMP, 2 bytes in UTF-8
        assert_eq!(utf16_len("😀"), 2); // astral, surrogate pair in UTF-16
        assert_eq!(utf16_len("a\u{FFFD}b"), 3); // what a lone JS surrogate becomes
    }
}
