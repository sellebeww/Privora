// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Vassel Goleyu
//! UTF-8 byte offset to UTF-16 index conversion.
#![allow(
    clippy::arithmetic_side_effects,
    clippy::expect_used,
    clippy::indexing_slicing,
    clippy::unwrap_used
)]

use privora_core::offsets::Utf16Map;

fn reference(text: &str, byte: usize) -> usize {
    text[..byte].encode_utf16().count()
}

fn check_all_boundaries(text: &str) {
    let m = Utf16Map::new(text);
    for (b, _) in text.char_indices() {
        assert_eq!(m.to_utf16(b), reference(text, b), "{text:?} @ {b}");
    }
    assert_eq!(m.to_utf16(text.len()), text.encode_utf16().count());
}

#[test]
fn empty_text() {
    let m = Utf16Map::new("");
    assert_eq!(m.to_utf16(0), 0);
    check_all_boundaries("");
}

#[test]
fn ascii_is_identity() {
    check_all_boundaries("hello world 123");
}

#[test]
fn diacritics_precomposed_and_combining() {
    check_all_boundaries("café ünïcödé");
    check_all_boundaries("Cafe\u{301}"); // combining acute
}

#[test]
fn emoji_and_astral() {
    check_all_boundaries("😀");
    check_all_boundaries("a😀b😀😀c");
    check_all_boundaries("𝒳𝒴𝒵");
    check_all_boundaries("\u{1F468}\u{200D}\u{1F469}\u{200D}\u{1F467}"); // ZWJ family
}

#[test]
fn three_byte_bmp_and_mixed() {
    check_all_boundaries("日本語のテキスト");
    check_all_boundaries("a日b😀cé");
    check_all_boundaries("\u{FFFD}x\u{FFFD}");
}

#[test]
fn offsets_past_the_end_do_not_panic() {
    let m = Utf16Map::new("a😀");
    let _ = m.to_utf16(1000);
    let _ = m.to_utf16(usize::MAX);
}
