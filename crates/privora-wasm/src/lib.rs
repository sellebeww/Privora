// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Vassel Goleyu
//! Thin wasm-bindgen wrapper around `privora-core`. Every export delegates to [`api`]; failures
//! are thrown as a bare error code string (see `ApiError::code`). The core never panics on
//! user input (property tests), and no export here unwraps, indexes or does unchecked math.

pub mod api;

use wasm_bindgen::prelude::*;

fn code(e: api::ApiError) -> String {
    e.code().to_owned()
}

/// Name of the engine, proves a call crosses the wasm boundary.
#[wasm_bindgen]
pub fn engine_name() -> String {
    privora_core::engine_name().to_owned()
}

/// UTF-16 length of the text as seen by Rust. A lone JS surrogate arrives as U+FFFD
/// (one UTF-16 unit), so offsets stay aligned with the JS string.
#[wasm_bindgen]
pub fn utf16_len(text: &str) -> u32 {
    u32::try_from(privora_core::utf16_len(text)).unwrap_or(u32::MAX)
}

#[wasm_bindgen]
pub fn version() -> String {
    api::version()
}

#[wasm_bindgen]
pub fn scan(text: &str, options_json: &str) -> Result<String, String> {
    api::scan(text, options_json).map_err(code)
}

#[wasm_bindgen]
pub fn redact(text: &str, spans_json: &str, style: &str) -> Result<String, String> {
    api::redact(text, spans_json, style).map_err(code)
}

#[wasm_bindgen]
pub fn tokenize(text: &str, spans_json: &str) -> Result<String, String> {
    api::tokenize(text, spans_json).map_err(code)
}

#[wasm_bindgen]
pub fn restore(text: &str, map_json: &str, mode: &str) -> Result<String, String> {
    api::restore(text, map_json, mode).map_err(code)
}

#[wasm_bindgen]
pub fn find_occurrences(text: &str, needle: &str) -> Result<String, String> {
    api::find_occurrences(text, needle).map_err(code)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wrapper_delegates_to_core() {
        assert_eq!(engine_name(), "privora-core");
        assert_eq!(utf16_len("a😀"), 3);
    }
}
