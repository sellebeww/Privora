// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Vassel Goleyu
//! Context keyword search: case-insensitive, word-bounded, within 40 characters before a
//! position, on the same line or the previous line.

/// Keywords are lowercase ASCII.
pub const NIK: &[&str] = &[
    "nik",
    "ktp",
    "no. identitas",
    "no identitas",
    "nomor identitas",
    "nomor induk kependudukan",
];
pub const KK: &[&str] = &["kk", "kartu keluarga"];
pub const NPWP: &[&str] = &["npwp"];
pub const PHONE: &[&str] = &["telp", "telepon", "hp", "wa", "whatsapp", "phone", "kontak"];
pub const CARD: &[&str] = &["kartu", "card", "cc", "kredit", "debit"];

const WINDOW_CHARS: usize = 40;

/// True when one of `keywords` occurs as a whole word in the window before byte offset `pos`.
/// `pos` must be a char boundary of `text`; otherwise the answer is `false`.
pub fn near(text: &str, pos: usize, keywords: &[&str]) -> bool {
    let Some(head) = text.get(..pos) else {
        return false;
    };
    let mut start = pos;
    let mut chars = 0usize;
    let mut breaks = 0u8;
    for (i, c) in head.char_indices().rev() {
        if chars == WINDOW_CHARS {
            break;
        }
        if c == '\n' {
            breaks = breaks.saturating_add(1);
            if breaks == 2 {
                break;
            }
        }
        start = i;
        chars = chars.saturating_add(1);
    }
    let Some(window) = head.get(start..) else {
        return false;
    };
    let lower = window.to_ascii_lowercase();
    keywords.iter().any(|kw| {
        lower.match_indices(kw).any(|(i, m)| {
            // Looks into the text before the window too: the window may start inside a word.
            let before_ok = head
                .get(..start.saturating_add(i))
                .and_then(|s| s.chars().next_back())
                .is_none_or(|c| !c.is_alphanumeric());
            let after_ok = lower
                .get(i.saturating_add(m.len())..)
                .and_then(|s| s.chars().next())
                .is_none_or(|c| !c.is_alphanumeric());
            before_ok && after_ok
        })
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn near_basics() {
        assert!(near("NIK: 123", 5, NIK));
        assert!(near("nik 123", 4, NIK));
        assert!(!near("SENIK 123", 6, NIK));
        assert!(!near("NIK 123", 99, NIK)); // out of range
        assert!(!near("é", 1, NIK)); // not a char boundary
    }

    #[test]
    fn two_line_limit_and_char_limit() {
        let t = "NIK\nx\n1";
        assert!(!near(t, t.len().saturating_sub(1), NIK));
        let t = "NIK\n1";
        assert!(near(t, 4, NIK));
    }

    #[test]
    fn keyword_with_dots_and_spaces() {
        assert!(near("No. Identitas: 1", 15, NIK));
        assert!(near("Kartu Keluarga 1", 15, KK));
    }
}
