// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Vassel Goleyu
//! Payment card numbers: 13 to 19 digits, plain or in groups of four joined by a single space
//! or hyphen, Luhn valid, first digit 3 to 6.

use super::{Candidate, digits_of, is_sep, run_len, run_start};
use crate::keywords;
use crate::types::{Confidence, Kind, Validation};

pub(crate) fn luhn(digits: &str) -> bool {
    let mut sum = 0u32;
    let mut n = 0usize;
    for (i, c) in digits.chars().rev().enumerate() {
        let Some(mut d) = c.to_digit(10) else {
            return false;
        };
        if i % 2 == 1 {
            d = d.saturating_mul(2);
            if d > 9 {
                d = d.saturating_sub(9);
            }
        }
        sum = sum.saturating_add(d);
        n = n.saturating_add(1);
    }
    n > 0 && sum.is_multiple_of(10)
}

/// Candidate ends (byte end, digit count) at group boundaries, for a run start `i`.
fn grouped_ends(b: &[u8], i: usize) -> Vec<(usize, usize)> {
    let mut ends = Vec::new();
    let (mut pos, mut total) = (i, 0usize);
    let mut sep: Option<u8> = None;
    loop {
        let r = run_len(b, pos);
        if r == 0 || r > 4 || total.saturating_add(r) > 19 {
            break;
        }
        total = total.saturating_add(r);
        let end = pos.saturating_add(r);
        ends.push((end, total));
        if r < 4 {
            break;
        }
        match (b.get(end), b.get(end.saturating_add(1))) {
            (Some(s), Some(d))
                if is_sep(*s)
                    && *s != b'.'
                    && d.is_ascii_digit()
                    && sep.is_none_or(|x| x == *s) =>
            {
                sep = Some(*s);
                pos = end.saturating_add(1);
            }
            _ => break,
        }
    }
    ends
}

fn card_at(b: &[u8], i: usize) -> Option<(usize, String)> {
    let r = run_len(b, i);
    let ok = |end: usize| {
        let d = digits_of(b, i, end);
        ((13..=19).contains(&d.len())
            && matches!(d.as_bytes().first(), Some(b'3'..=b'6'))
            && luhn(&d))
        .then_some((end, d))
    };
    if (13..=19).contains(&r) {
        return ok(i.saturating_add(r));
    }
    if r == 4 {
        return grouped_ends(b, i)
            .into_iter()
            .rev()
            .find_map(|(end, _)| ok(end));
    }
    None
}

pub(crate) fn detect(text: &str, out: &mut Vec<Candidate>) {
    let b = text.as_bytes();
    for i in 0..b.len() {
        if !run_start(b, i) {
            continue;
        }
        if let Some((end, _)) = card_at(b, i) {
            let keyword = keywords::near(text, i, keywords::CARD);
            out.push(Candidate {
                kind: Kind::Card,
                start: i,
                end,
                confidence: if keyword {
                    Confidence::Tinggi
                } else {
                    Confidence::Sedang
                },
                reason: if keyword {
                    "KARTU_LUHN_KATA_KUNCI"
                } else {
                    "KARTU_LUHN"
                },
                validation: Some(Validation::Luhn),
            });
        }
    }
}
