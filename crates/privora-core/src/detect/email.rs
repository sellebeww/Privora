// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Vassel Goleyu
//! Pragmatic email pattern (not RFC 5322). Each byte is scanned by at most one backward local
//! part scan and one forward domain scan, so the cost is linear.

use super::Candidate;
use crate::types::{Confidence, Kind};

fn is_local(c: u8) -> bool {
    c.is_ascii_alphanumeric() || matches!(c, b'.' | b'_' | b'%' | b'+' | b'-')
}

fn is_domain(c: u8) -> bool {
    c.is_ascii_alphanumeric() || matches!(c, b'.' | b'-')
}

/// Length of the longest prefix of `d` that is a domain: two or more labels, none empty or edged
/// with a hyphen, ending in two or more letters. Text glued to an address (`x@mail.com.2024`,
/// `x@mail.com-1`) must not hide it. One pass.
fn domain_len(d: &[u8]) -> Option<usize> {
    let mut best = None;
    let mut at = 0usize;
    for (k, label) in d.split(|c| *c == b'.').enumerate() {
        if label.is_empty() || label.first() == Some(&b'-') {
            break;
        }
        let letters = label.iter().take_while(|c| c.is_ascii_alphabetic()).count();
        if k > 0 && letters >= 2 && label.get(letters).is_none_or(|c| *c == b'-') {
            best = Some(at.saturating_add(letters));
        }
        if label.last() == Some(&b'-') {
            break;
        }
        at = at.saturating_add(label.len()).saturating_add(1);
    }
    best
}

pub(crate) fn detect(text: &str, out: &mut Vec<Candidate>) {
    let b = text.as_bytes();
    for (at, &c) in b.iter().enumerate() {
        if c != b'@' {
            continue;
        }
        let mut start = at;
        while start > 0
            && start
                .checked_sub(1)
                .and_then(|p| b.get(p))
                .is_some_and(|c| is_local(*c))
        {
            start = start.saturating_sub(1);
        }
        while start < at
            && b.get(start)
                .is_some_and(|c| matches!(c, b'.' | b'-' | b'+' | b'%'))
        {
            start = start.saturating_add(1);
        }
        if start == at {
            continue;
        }
        let dom_start = at.saturating_add(1);
        let mut end = dom_start;
        while b.get(end).is_some_and(|c| is_domain(*c)) {
            end = end.saturating_add(1);
        }
        if let Some(len) = b.get(dom_start..end).and_then(domain_len) {
            out.push(Candidate {
                kind: Kind::Email,
                start,
                end: dom_start.saturating_add(len),
                confidence: Confidence::Tinggi,
                reason: "EMAIL_FORMAT",
                validation: None,
            });
        }
    }
}
