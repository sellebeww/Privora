// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Vassel Goleyu
//! Permanent redaction and the span helpers shared with tokenisation.
//! Spans are UTF-16 code unit ranges, `end` exclusive, like every offset of the public API.

use crate::offsets::Utf16Map;
use crate::types::{Finding, Kind};

/// A range to hide. `kind` is `None` for a manual selection.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Span {
    pub start: usize,
    pub end: usize,
    pub kind: Option<Kind>,
}

impl From<&Finding> for Span {
    fn from(f: &Finding) -> Self {
        Span {
            start: f.start,
            end: f.end,
            kind: Some(f.kind),
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub enum RedactStyle {
    /// `[NIK]`. Default.
    #[default]
    Label,
    /// Eight `\u{2588}` whatever the length of the value.
    Block,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RedactError {
    /// Out of range, `start > end`, or an edge inside a surrogate pair.
    InvalidSpan,
}

const BLOCK: &str = "\u{2588}\u{2588}\u{2588}\u{2588}\u{2588}\u{2588}\u{2588}\u{2588}";

fn is_high(u: u16) -> bool {
    (0xD800..0xDC00).contains(&u)
}

fn is_low(u: u16) -> bool {
    (0xDC00..0xE000).contains(&u)
}

/// Validate, drop empty spans, sort, and merge overlapping ones. Touching spans stay separate.
/// A merged span keeps a kind only if exactly one distinct kind is present among its members.
pub(crate) fn normalize(units: &[u16], spans: &[Span]) -> Result<Vec<Span>, RedactError> {
    let edge_ok = |i: usize| -> bool {
        i <= units.len()
            && !(i > 0
                && units.get(i).is_some_and(|u| is_low(*u))
                && units.get(i.saturating_sub(1)).is_some_and(|u| is_high(*u)))
    };
    let mut v: Vec<Span> = Vec::with_capacity(spans.len());
    for s in spans {
        if s.start > s.end || !edge_ok(s.start) || !edge_ok(s.end) {
            return Err(RedactError::InvalidSpan);
        }
        if s.start < s.end {
            v.push(*s);
        }
    }
    v.sort_by_key(|s| (s.start, s.end));
    let mut out: Vec<Span> = Vec::with_capacity(v.len());
    // kinds seen in the span being built: (first Some kind, saw a different one)
    let mut conflict = false;
    for s in v {
        match out.last_mut() {
            Some(last) if s.start < last.end => {
                last.end = last.end.max(s.end);
                match (last.kind, s.kind) {
                    (Some(a), Some(b)) if a != b => conflict = true,
                    (None, Some(b)) => last.kind = Some(b),
                    _ => {}
                }
                if conflict {
                    last.kind = None;
                }
            }
            _ => {
                conflict = false;
                out.push(s);
            }
        }
    }
    Ok(out)
}

fn units_to_string(units: &[u16]) -> Result<String, RedactError> {
    String::from_utf16(units).map_err(|_| RedactError::InvalidSpan)
}

/// Replace each span with a label or a block. Spans may be unsorted and overlapping (merged).
pub fn redact(text: &str, spans: &[Span], style: RedactStyle) -> Result<String, RedactError> {
    let units: Vec<u16> = text.encode_utf16().collect();
    let spans = normalize(&units, spans)?;
    let mut out = String::with_capacity(text.len());
    let mut at = 0usize;
    for s in spans {
        out.push_str(&units_to_string(
            units.get(at..s.start).unwrap_or_default(),
        )?);
        match style {
            RedactStyle::Block => out.push_str(BLOCK),
            RedactStyle::Label => {
                out.push('[');
                out.push_str(s.kind.map_or("DATA", Kind::label));
                out.push(']');
            }
        }
        at = s.end;
    }
    out.push_str(&units_to_string(units.get(at..).unwrap_or_default())?);
    Ok(out)
}

/// Every exact (case sensitive), non overlapping occurrence of `needle`, as UTF-16 ranges.
/// An empty needle matches nothing.
pub fn find_all(text: &str, needle: &str) -> Vec<(usize, usize)> {
    if needle.is_empty() {
        return Vec::new();
    }
    let map = Utf16Map::new(text);
    text.match_indices(needle)
        .map(|(i, m)| (map.to_utf16(i), map.to_utf16(i.saturating_add(m.len()))))
        .collect()
}
