// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Vassel Goleyu
//! Label based heuristics: name, address, birth date. No model, only rules.
//! Every range edge is a char boundary because values are walked with `char_indices`.

use super::{Candidate, digit_at, run_len};
use crate::nik::days_in_month;
use crate::types::{Confidence, Kind};

const ADDRESS_MAX_CHARS: usize = 160;
const BIRTH_MAX_CHARS: usize = 60;
const NAME_MAX_WORDS: usize = 6;
/// A continuation line of an address must start with one of these whole words.
const CONTINUATION: &[&str] = &[
    "rt",
    "rw",
    "kel",
    "kelurahan",
    "kec",
    "kecamatan",
    "kab",
    "kabupaten",
    "kota",
    "no",
];

pub(crate) fn detect(text: &str, out: &mut Vec<Candidate>) {
    let mut lines = Vec::new();
    let mut at = 0usize;
    for l in text.split('\n') {
        lines.push((at, l.strip_suffix('\r').unwrap_or(l)));
        at = at.saturating_add(l.len()).saturating_add(1);
    }
    for (k, &(base, line)) in lines.iter().enumerate() {
        scan_line(base, line, lines.get(k.saturating_add(1)).copied(), out);
    }
}

#[derive(Clone, Copy)]
enum Label {
    Name,
    Address,
    Birth,
}

fn scan_line(base: usize, line: &str, next: Option<(usize, &str)>, out: &mut Vec<Candidate>) {
    let lower = line.to_ascii_lowercase();
    let mut i = 0usize;
    while i < lower.len() {
        let starts_word = lower.is_char_boundary(i)
            && lower
                .get(..i)
                .and_then(|s| s.chars().next_back())
                .is_none_or(|c| !c.is_alphanumeric());
        let hit = if starts_word {
            match_label(&lower, i)
        } else {
            None
        };
        let Some((label, label_end)) = hit else {
            i = i.saturating_add(1);
            continue;
        };
        let Some(vstart) = value_start(line, label_end) else {
            i = label_end;
            continue;
        };
        let end = match label {
            Label::Name => name_end(line, vstart).map(|e| (e, Confidence::Rendah, "NAMA_BERLABEL")),
            Label::Address => address_end(base, line, vstart, next)
                .map(|e| (e, Confidence::Rendah, "ALAMAT_BERLABEL")),
            Label::Birth => birth_end(line, vstart).map(|e| {
                let valid = line.get(vstart..e).is_some_and(has_valid_date);
                if valid {
                    (e, Confidence::Sedang, "TGL_LAHIR_FORMAT_VALID")
                } else {
                    (e, Confidence::Rendah, "TGL_LAHIR_BERLABEL")
                }
            }),
        };
        i = label_end;
        let Some((e, confidence, reason)) = end else {
            continue;
        };
        let kind = match label {
            Label::Name => Kind::Name,
            Label::Address => Kind::Address,
            Label::Birth => Kind::BirthDate,
        };
        // Address end may be on the next line: it is an absolute offset from `text`, the others
        // are relative to `line`.
        let (start, end) = match label {
            Label::Address => (base.saturating_add(vstart), e),
            _ => (base.saturating_add(vstart), base.saturating_add(e)),
        };
        out.push(Candidate {
            kind,
            start,
            end,
            confidence,
            reason,
            validation: None,
        });
        // Do not look for labels inside the value just taken (same line only).
        let rel = end.saturating_sub(base);
        if rel <= line.len() {
            i = i.max(rel);
        }
    }
}

/// Which label starts at byte `i` of the lower-cased line, and where it ends.
fn match_label(lower: &str, i: usize) -> Option<(Label, usize)> {
    let rest = lower.get(i..)?;
    let len = |r: &str| lower.len().saturating_sub(r.len());
    for l in ["nama lengkap", "nama pemohon", "atas nama", "nama"] {
        if let Some(r) = rest.strip_prefix(l) {
            return Some((Label::Name, len(r)));
        }
    }
    if let Some(r) = rest.strip_prefix("a.n.") {
        return Some((Label::Name, len(r)));
    }
    if let Some(r) = rest.strip_prefix("alamat") {
        return Some((Label::Address, len(r)));
    }
    let mut p = rest;
    if let Some(r) = p.strip_prefix("tempat") {
        let t = r.trim_start_matches([' ', ',', '/']);
        if t.len() == r.len() {
            return None;
        }
        p = t;
    }
    p = p
        .strip_prefix("tanggal")
        .or_else(|| p.strip_prefix("tgl"))?;
    p = p.strip_prefix('.').unwrap_or(p);
    p = p.trim_start_matches(' ').strip_prefix("lahir")?;
    Some((Label::Birth, len(p)))
}

/// After the label: optional spaces, `:` or `=`, optional spaces. Returns the value start.
fn value_start(line: &str, label_end: usize) -> Option<usize> {
    let rest = line.get(label_end..)?;
    let r = rest.trim_start_matches([' ', '\t']);
    let r = r.strip_prefix(':').or_else(|| r.strip_prefix('='))?;
    let r = r.trim_start_matches([' ', '\t']);
    Some(line.len().saturating_sub(r.len()))
}

/// Letters, name punctuation, and combining marks (a decomposed accent is part of its letter).
fn is_word_char(c: char) -> bool {
    c.is_alphabetic() || matches!(c, '.' | '\'' | '\u{2019}' | '-' | '\u{300}'..='\u{36f}')
}

/// 1 to 6 words of letters; stops at a digit, tab, two spaces in a row, any other symbol or EOL.
fn name_end(line: &str, vstart: usize) -> Option<usize> {
    let rest = line.get(vstart..)?;
    let mut pos = 0usize; // relative to vstart
    let mut end = 0usize;
    let mut words = 0usize;
    loop {
        let tail = rest.get(pos..)?;
        let word_len: usize = tail
            .chars()
            .take_while(|c| is_word_char(*c))
            .map(char::len_utf8)
            .sum();
        let word = tail.get(..word_len).unwrap_or_default();
        if !word.chars().next().is_some_and(char::is_alphabetic) {
            break;
        }
        pos = pos.saturating_add(word_len);
        end = pos;
        words = words.saturating_add(1);
        if words == NAME_MAX_WORDS {
            break;
        }
        // exactly one space, then another word
        let after = rest.get(pos..)?;
        match after.strip_prefix(' ') {
            Some(n) if n.chars().next().is_some_and(char::is_alphabetic) => {
                pos = pos.saturating_add(1);
            }
            _ => break,
        }
    }
    if words == 0 {
        return None;
    }
    // drop a sentence dot after a long last word ("Santoso."), keep initials ("S.")
    let mut value = rest.get(..end)?;
    while let Some(v) = value.strip_suffix(['-', '\'', '\u{2019}']) {
        value = v;
    }
    if let Some(v) = value.strip_suffix('.') {
        let last = v.rsplit(' ').next().unwrap_or_default();
        if last.chars().count() >= 3 && last.chars().all(char::is_alphabetic) {
            value = v;
        }
    }
    (!value.is_empty()).then(|| vstart.saturating_add(value.len()))
}

/// Byte index of the end of the first `max` chars of `s` (or its length).
fn cap_chars(s: &str, max: usize) -> usize {
    s.char_indices().nth(max).map_or(s.len(), |(i, _)| i)
}

/// Absolute end offset of an address value: same line (160 chars) plus one continuation line.
fn address_end(
    base: usize,
    line: &str,
    vstart: usize,
    next: Option<(usize, &str)>,
) -> Option<usize> {
    let rest = line.get(vstart..)?;
    let capped = rest.get(..cap_chars(rest, ADDRESS_MAX_CHARS))?;
    let value = capped.trim_end();
    if value.is_empty() {
        return None;
    }
    let first_end = base.saturating_add(vstart).saturating_add(value.len());
    // Continuation only when the first line was not cut by the cap.
    if capped.len() < rest.len() {
        return Some(first_end);
    }
    if let Some((nbase, nline)) = next {
        let trimmed = nline.trim_start();
        let lead = nline.len().saturating_sub(trimmed.len());
        let word_len: usize = trimmed
            .chars()
            .take_while(|c| c.is_alphabetic())
            .map(char::len_utf8)
            .sum();
        let word = trimmed
            .get(..word_len)
            .unwrap_or_default()
            .to_ascii_lowercase();
        // `No` only starts an address line when a number follows ("No. 7"); "No. HP: ..." is the
        // next field, not an address (D-23).
        let number_after_no = || {
            trimmed
                .get(word_len..)
                .map(|t| t.trim_start_matches(['.', ' ']))
                .and_then(|t| t.chars().next())
                .is_some_and(|c| c.is_ascii_digit())
        };
        if CONTINUATION.contains(&word.as_str()) && (word != "no" || number_after_no()) {
            let cap = trimmed
                .get(..cap_chars(trimmed, ADDRESS_MAX_CHARS))?
                .trim_end();
            return Some(nbase.saturating_add(lead).saturating_add(cap.len()));
        }
    }
    Some(first_end)
}

fn birth_end(line: &str, vstart: usize) -> Option<usize> {
    let rest = line.get(vstart..)?;
    let value = rest.get(..cap_chars(rest, BIRTH_MAX_CHARS))?.trim_end();
    (!value.is_empty()).then(|| vstart.saturating_add(value.len()))
}

fn month_number(word: &str) -> Option<u8> {
    let w = word.trim_end_matches('.').to_ascii_lowercase();
    Some(match w.as_str() {
        "januari" | "jan" => 1,
        "februari" | "pebruari" | "feb" => 2,
        "maret" | "mar" => 3,
        "april" | "apr" => 4,
        "mei" => 5,
        "juni" | "jun" => 6,
        "juli" | "jul" => 7,
        "agustus" | "agu" | "agt" | "ags" | "agust" => 8,
        "september" | "sep" | "sept" => 9,
        "oktober" | "okt" => 10,
        "november" | "nopember" | "nov" | "nop" => 11,
        "desember" | "des" => 12,
        _ => return None,
    })
}

fn real_date(year: i32, month: u8, day: u8) -> bool {
    (1900..=2100).contains(&year) && day >= 1 && day <= days_in_month(year, month)
}

fn number(b: &[u8], i: usize, len: usize) -> Option<u32> {
    let s = std::str::from_utf8(b.get(i..i.saturating_add(len))?).ok()?;
    s.parse().ok()
}

/// A calendar-valid `DD-MM-YYYY`, `DD/MM/YYYY` or `D MonthName YYYY` somewhere in `value`.
fn has_valid_date(value: &str) -> bool {
    let b = value.as_bytes();
    (0..b.len()).any(|i| {
        let starts = digit_at(b, i)
            && i.checked_sub(1)
                .is_none_or(|p| !b.get(p).is_some_and(u8::is_ascii_alphanumeric));
        if !starts {
            return false;
        }
        let dl = run_len(b, i);
        if !(1..=2).contains(&dl) {
            return false;
        }
        let Some(day) = number(b, i, dl).and_then(|d| u8::try_from(d).ok()) else {
            return false;
        };
        let p = i.saturating_add(dl);
        match b.get(p) {
            Some(&sep @ (b'-' | b'/')) => {
                let m0 = p.saturating_add(1);
                let ml = run_len(b, m0);
                if !(1..=2).contains(&ml) || b.get(m0.saturating_add(ml)) != Some(&sep) {
                    return false;
                }
                let y0 = m0.saturating_add(ml).saturating_add(1);
                if run_len(b, y0) != 4 {
                    return false;
                }
                match (number(b, m0, ml), number(b, y0, 4)) {
                    (Some(m), Some(y)) => match (u8::try_from(m), i32::try_from(y)) {
                        (Ok(m), Ok(y)) => real_date(y, m, day),
                        _ => false,
                    },
                    _ => false,
                }
            }
            Some(b' ') => {
                let rest = value.get(p..).unwrap_or_default();
                let mut it = rest.split(' ').filter(|s| !s.is_empty());
                let (Some(mw), Some(yw)) = (it.next(), it.next()) else {
                    return false;
                };
                let (Some(m), true) = (month_number(mw), yw.len() >= 4) else {
                    return false;
                };
                let ys = yw.get(..4).unwrap_or_default();
                let after_ok = yw
                    .get(4..)
                    .is_none_or(|t| t.chars().next().is_none_or(|c| !c.is_ascii_digit()));
                match ys.parse::<i32>() {
                    Ok(y) if ys.bytes().all(|c| c.is_ascii_digit()) && after_ok => {
                        real_date(y, m, day)
                    }
                    _ => false,
                }
            }
            _ => false,
        }
    })
}
