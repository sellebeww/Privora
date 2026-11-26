// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Vassel Goleyu
//! Indonesian mobile numbers: prefix `+62`, `62` or `0`, then 9 to 12 digits starting with 8,
//! groups joined by a single space, dot or hyphen. Not part of a longer digit run.

use super::{Candidate, digit_at, is_sep, run_len, run_start};
use crate::keywords;
use crate::types::{Confidence, Kind};

const MIN_DIGITS: usize = 9;
const MAX_DIGITS: usize = 12;

fn phone_end(b: &[u8], i: usize) -> Option<usize> {
    let first = *b.get(i)?;
    let mut pos;
    let mut international = true;
    if first == b'+' {
        if b.get(i.saturating_add(1)..i.saturating_add(3)) != Some(b"62") {
            return None;
        }
        pos = i.saturating_add(3);
    } else if b.get(i..i.saturating_add(2)) == Some(b"62") {
        pos = i.saturating_add(2);
    } else if first == b'0' {
        pos = i.saturating_add(1);
        international = false;
    } else {
        return None;
    }
    // One optional separator after 62 / +62.
    if international
        && b.get(pos).is_some_and(|c| is_sep(*c))
        && b.get(pos.saturating_add(1)) == Some(&b'8')
    {
        pos = pos.saturating_add(1);
    }
    if b.get(pos) != Some(&b'8') {
        return None;
    }
    let mut digits = 0usize;
    let mut end = pos;
    loop {
        let r = run_len(b, pos);
        let total = digits.saturating_add(r);
        if total > MAX_DIGITS {
            if digits == 0 {
                return None; // the first run alone is too long: part of a longer number
            }
            break;
        }
        digits = total;
        end = pos.saturating_add(r);
        match (b.get(end), digit_at(b, end.saturating_add(1))) {
            (Some(s), true) if is_sep(*s) => pos = end.saturating_add(1),
            _ => break,
        }
    }
    (digits >= MIN_DIGITS).then_some(end)
}

pub(crate) fn detect(text: &str, out: &mut Vec<Candidate>) {
    let b = text.as_bytes();
    for (i, &c) in b.iter().enumerate() {
        let starts = match c {
            b'+' => i.checked_sub(1).is_none_or(|p| !digit_at(b, p)),
            b'0' => run_start(b, i),
            // A '6' right after '+' belongs to the `+62` match started at the '+'.
            b'6' => run_start(b, i) && i.checked_sub(1).and_then(|p| b.get(p)) != Some(&b'+'),
            _ => false,
        };
        if !starts {
            continue;
        }
        if let Some(end) = phone_end(b, i) {
            let keyword = keywords::near(text, i, keywords::PHONE);
            out.push(Candidate {
                kind: Kind::Phone,
                start: i,
                end,
                confidence: if keyword {
                    Confidence::Tinggi
                } else {
                    Confidence::Sedang
                },
                reason: if keyword {
                    "TELEPON_KATA_KUNCI"
                } else {
                    "TELEPON_FORMAT"
                },
                validation: None,
            });
        }
    }
}
