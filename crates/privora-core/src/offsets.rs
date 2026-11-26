// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Vassel Goleyu
//! UTF-8 byte offset to UTF-16 code unit index, built in one pass.

/// Sparse map: one entry per non-ASCII char, so pure ASCII text costs nothing and
/// lookups are a binary search.
#[derive(Clone, Debug, Default)]
pub struct Utf16Map {
    /// `(byte start of the char, cumulative bytes minus units up to and including it)`.
    entries: Vec<(usize, usize)>,
}

impl Utf16Map {
    pub fn new(text: &str) -> Self {
        let mut entries = Vec::new();
        let mut saved = 0usize;
        for (start, c) in text.char_indices() {
            if c.is_ascii() {
                continue;
            }
            saved = saved.saturating_add(c.len_utf8().saturating_sub(c.len_utf16()));
            entries.push((start, saved));
        }
        Self { entries }
    }

    /// UTF-16 index for a byte offset that lies on a char boundary (also `text.len()`).
    /// Offsets past the end are clamped by the arithmetic, never a panic.
    pub fn to_utf16(&self, byte: usize) -> usize {
        let n = self.entries.partition_point(|&(start, _)| start < byte);
        let saved = n
            .checked_sub(1)
            .and_then(|i| self.entries.get(i))
            .map_or(0, |&(_, s)| s);
        byte.saturating_sub(saved)
    }
}
