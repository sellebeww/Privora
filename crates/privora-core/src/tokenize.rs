// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Vassel Goleyu
//! Reversible tokenisation and restore.
//!
//! Token form: `[[TYPE_n]]`, or `[[PRV-TYPE_n]]` when the kept text already holds something that
//! looks like one of the generated tokens. The map holds the original values: it is personal data.
//! Invariant: `restore(tokenize(x).text, map, mode) == x` for both modes.

use std::collections::{HashMap, HashSet};

use crate::offsets::Utf16Map;
use crate::redact::{RedactError, Span, normalize};
use crate::types::Kind;

/// Token to original value, in order of first appearance.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct TokenMap {
    entries: Vec<(String, String)>,
}

impl TokenMap {
    pub fn new(entries: Vec<(String, String)>) -> Self {
        Self { entries }
    }

    pub fn entries(&self) -> &[(String, String)] {
        &self.entries
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Tokenized {
    pub text: String,
    pub map: TokenMap,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TokenizeError {
    InvalidSpan,
    /// Both `[[TYPE_n]]` and `[[PRV-TYPE_n]]` already occur in the kept text.
    TokenCollision,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub enum RestoreMode {
    /// Exact token strings only. Default.
    #[default]
    Strict,
    /// Also accepts other letter case and spaces inside the brackets, and flags those.
    Tolerant,
}

/// A tolerant replacement: where it was in the input (UTF-16) and what was written.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Flag {
    pub start: usize,
    pub end: usize,
    pub found: String,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct RestoreReport {
    /// Number of replacements made (strict and tolerant).
    pub restored: usize,
    /// Replacements that were not an exact token (tolerant mode only).
    pub flagged: Vec<Flag>,
    /// Map tokens that were not replaced anywhere, in map order.
    pub unused: Vec<String>,
    /// Token-like strings, as written, that are not in the map (first appearance, no duplicates).
    pub unknown: Vec<String>,
}

const NAMESPACES: [&str; 2] = ["", "PRV-"];
const MAX_BODY: usize = 64;

struct Like {
    start: usize,
    end: usize,
    /// Body in upper case, e.g. `NIK_1`.
    norm: String,
}

fn body_ok(body: &[u8]) -> bool {
    let Some(us) = body.iter().rposition(|c| *c == b'_') else {
        return false;
    };
    let (head, tail) = body.split_at(us);
    let digits = tail.get(1..).unwrap_or_default();
    head.first().is_some_and(u8::is_ascii_alphabetic)
        && !digits.is_empty()
        && digits.iter().all(u8::is_ascii_digit)
}

/// Every `[[` spaces? body spaces? `]]` where body is `LETTER (letters digits _ -)* _ DIGITS`.
fn find_token_like(text: &str) -> Vec<Like> {
    let b = text.as_bytes();
    let mut out = Vec::new();
    let mut i = 0usize;
    while i < b.len() {
        if b.get(i) == Some(&b'[')
            && b.get(i.saturating_add(1)) == Some(&b'[')
            && let Some(l) = parse_like(b, i)
        {
            i = l.end;
            out.push(l);
            continue;
        }
        i = i.saturating_add(1);
    }
    out
}

fn parse_like(b: &[u8], i: usize) -> Option<Like> {
    let skip = |mut p: usize| {
        while b.get(p) == Some(&b' ') {
            p = p.saturating_add(1);
        }
        p
    };
    let q = skip(i.saturating_add(2));
    let mut p = q;
    while p.saturating_sub(q) <= MAX_BODY
        && b.get(p)
            .is_some_and(|c| c.is_ascii_alphanumeric() || *c == b'_' || *c == b'-')
    {
        p = p.saturating_add(1);
    }
    let body = b.get(q..p)?;
    if p.saturating_sub(q) > MAX_BODY || !body_ok(body) {
        return None;
    }
    let r = skip(p);
    if b.get(r) != Some(&b']') || b.get(r.saturating_add(1)) != Some(&b']') {
        return None;
    }
    Some(Like {
        start: i,
        end: r.saturating_add(2),
        norm: String::from_utf8_lossy(body).to_ascii_uppercase(),
    })
}

fn is_ws(u: u16) -> bool {
    char::from_u32(u32::from(u)).is_some_and(char::is_whitespace)
}

fn piece(units: &[u16], a: usize, b: usize) -> Result<String, TokenizeError> {
    String::from_utf16(units.get(a..b).unwrap_or_default()).map_err(|_| TokenizeError::InvalidSpan)
}

/// Replace each distinct value by one token. Spans may be unsorted and overlapping (merged); edge
/// whitespace of a span stays in the text so that the round trip is exact. Two values share a
/// token only when they are identical strings: an e-mail that differs in letter case gets its own
/// token, because one map value could not restore both spellings (DECISIONS D-23).
pub fn tokenize(text: &str, spans: &[Span]) -> Result<Tokenized, TokenizeError> {
    let units: Vec<u16> = text.encode_utf16().collect();
    let spans =
        normalize(&units, spans).map_err(|RedactError::InvalidSpan| TokenizeError::InvalidSpan)?;

    // trimmed cores: (start, end, kind)
    let mut cores: Vec<(usize, usize, Option<Kind>)> = Vec::with_capacity(spans.len());
    for s in spans {
        let (mut a, mut b) = (s.start, s.end);
        while a < b && units.get(a).is_some_and(|u| is_ws(*u)) {
            a = a.saturating_add(1);
        }
        while b > a && units.get(b.saturating_sub(1)).is_some_and(|u| is_ws(*u)) {
            b = b.saturating_sub(1);
        }
        if a < b {
            cores.push((a, b, s.kind));
        }
    }

    // one entry per distinct value: (label, n, value)
    let mut entries: Vec<(&'static str, usize, String)> = Vec::new();
    let mut index: HashMap<String, usize> = HashMap::new();
    let mut counters: HashMap<&'static str, usize> = HashMap::new();
    let mut assigned: Vec<usize> = Vec::with_capacity(cores.len());
    for &(a, b, kind) in &cores {
        let value = piece(&units, a, b)?;
        let idx = match index.get(&value) {
            Some(&i) => i,
            None => {
                let label = kind.map_or("DATA", Kind::label);
                let n = counters.entry(label).or_insert(0);
                *n = n.saturating_add(1);
                entries.push((label, *n, value.clone()));
                index.insert(value, entries.len().saturating_sub(1));
                entries.len().saturating_sub(1)
            }
        };
        assigned.push(idx);
    }

    // kept text between the cores
    let mut kept: Vec<String> = Vec::with_capacity(cores.len().saturating_add(1));
    let mut at = 0usize;
    for &(a, b, _) in &cores {
        kept.push(piece(&units, at, a)?);
        at = b;
    }
    kept.push(piece(&units, at, units.len())?);
    let lookalikes: HashSet<String> = kept
        .iter()
        .flat_map(|k| find_token_like(k))
        .map(|l| l.norm)
        .collect();

    for ns in NAMESPACES {
        let names: Vec<String> = entries
            .iter()
            .map(|(label, n, _)| format!("{ns}{label}_{n}"))
            .collect();
        if names.iter().any(|n| lookalikes.contains(n)) {
            continue;
        }
        let tokens: Vec<String> = names.iter().map(|n| format!("[[{n}]]")).collect();
        let mut out = String::with_capacity(text.len());
        for (k, piece) in kept.iter().enumerate() {
            out.push_str(piece);
            if let Some(tok) = assigned.get(k).and_then(|i| tokens.get(*i)) {
                out.push_str(tok);
            }
        }
        let map = TokenMap::new(
            tokens
                .into_iter()
                .zip(entries.into_iter().map(|e| e.2))
                .collect(),
        );
        return Ok(Tokenized { text: out, map });
    }
    Err(TokenizeError::TokenCollision)
}

/// Put the original values back. Strict mode replaces exact tokens only; tolerant mode also
/// accepts other letter case and spaces inside the brackets and flags those replacements.
/// Replaced values are never scanned again.
pub fn restore(text: &str, map: &TokenMap, mode: RestoreMode) -> (String, RestoreReport) {
    let entries = map.entries();
    let mut exact: HashMap<&str, usize> = HashMap::new();
    let mut loose: HashMap<String, usize> = HashMap::new();
    for (i, (tok, _)) in entries.iter().enumerate() {
        exact.entry(tok.as_str()).or_insert(i);
        if let [l] = find_token_like(tok).as_slice()
            && l.start == 0
            && l.end == tok.len()
        {
            loose.entry(l.norm.clone()).or_insert(i);
        }
    }
    let utf16 = Utf16Map::new(text);
    let mut used = vec![false; entries.len()];
    let mut report = RestoreReport::default();
    let mut seen_unknown: HashSet<&str> = HashSet::new();
    let mut out = String::with_capacity(text.len());
    let mut at = 0usize;
    for l in find_token_like(text) {
        let written = text.get(l.start..l.end).unwrap_or_default();
        let hit = exact.get(written).copied().or_else(|| {
            (mode == RestoreMode::Tolerant)
                .then(|| loose.get(&l.norm).copied())
                .flatten()
        });
        let Some(i) = hit else {
            if seen_unknown.insert(written) {
                report.unknown.push(written.to_string());
            }
            continue;
        };
        out.push_str(text.get(at..l.start).unwrap_or_default());
        out.push_str(entries.get(i).map_or("", |e| e.1.as_str()));
        at = l.end;
        report.restored = report.restored.saturating_add(1);
        if let Some(u) = used.get_mut(i) {
            *u = true;
        }
        if !exact.contains_key(written) {
            report.flagged.push(Flag {
                start: utf16.to_utf16(l.start),
                end: utf16.to_utf16(l.end),
                found: written.to_string(),
            });
        }
    }
    out.push_str(text.get(at..).unwrap_or_default());
    report.unused = entries
        .iter()
        .zip(&used)
        .filter(|(_, u)| !**u)
        .map(|(e, _)| e.0.clone())
        .collect();
    (out, report)
}
