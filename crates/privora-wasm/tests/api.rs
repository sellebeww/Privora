// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Vassel Goleyu
//! Boundary contract of the wasm wrapper, run natively (the wrapper is plain Rust).
//! The golden file is shared with the Node test, which runs the same inputs through the real
//! wasm build: both sides must produce the same bytes. Bless with `PRIVORA_BLESS=1`.
#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::indexing_slicing,
    clippy::panic
)]

use privora_wasm::api::{self, ApiError, MAX_INPUT_BYTES};
use serde_json::{Value, json};

const OPTS: &str = r#"{"referenceDate":{"year":2026,"month":11,"day":25}}"#;

/// Synthetic documents only. The NIK has a valid structure and is invented.
fn docs() -> Vec<(&'static str, String)> {
    vec![
        ("empty", String::new()),
        (
            "form",
            "Nama: Budi Santoso\nNIK: 3174051509900001\nHP: 0812-3456-7890\nEmail: budi@example.com\nAlamat: Jl. Mawar No. 5, RT 01/RW 02\n"
                .to_owned(),
        ),
        (
            "emoji_and_diacritics",
            "\u{1F600}\u{1F600} Nama: Siti Nurhaliza \u{00C9}\u{00E9}\nNIK 3174055509950002 \u{1F44D} wa 081234567890 \u{1F600}\n"
                .to_owned(),
        ),
        (
            "token_lookalike",
            "Pesan [[NIK_1]] lama. NIK: 3174051509900001 dan 3174051509900001 lagi.".to_owned(),
        ),
    ]
}

fn utf16_len(s: &str) -> usize {
    s.encode_utf16().count()
}

fn spans_for(text: &str) -> Value {
    let f: Value = serde_json::from_str(&api::scan(text, OPTS).unwrap()).unwrap();
    Value::Array(
        f.as_array()
            .unwrap()
            .iter()
            .map(|x| json!({"start": x["start"], "end": x["end"], "kind": x["kind"]}))
            .collect(),
    )
}

#[test]
fn golden_matches_file() {
    let mut cases: Vec<Value> = Vec::new();
    for (name, text) in docs() {
        let spans = spans_for(&text);
        let spans_json = spans.to_string();
        let tokenized = api::tokenize(&text, &spans_json).unwrap();
        let tv: Value = serde_json::from_str(&tokenized).unwrap();
        let map = tv["map"].to_string();
        let tokens_text = tv["text"].as_str().unwrap().to_owned();
        let needle = text.get(0..4).unwrap_or("NIK");
        cases.push(json!({
            "name": name,
            "text": text,
            "options": OPTS,
            "spans": spans_json,
            "scan": api::scan(&text, OPTS).unwrap(),
            "redactLabel": api::redact(&text, &spans_json, "LABEL").unwrap(),
            "redactBlock": api::redact(&text, &spans_json, "BLOK").unwrap(),
            "tokenize": tokenized,
            "restoreStrict": api::restore(&tokens_text, &map, "STRICT").unwrap(),
            "restoreTolerant": api::restore(&tokens_text, &map, "TOLERANT").unwrap(),
            "needle": needle,
            "find": api::find_occurrences(&text, needle).unwrap(),
        }));
    }
    let actual = serde_json::to_string_pretty(&json!({"cases": cases})).unwrap() + "\n";
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../web/src/engine/fixtures/golden.json");
    if std::env::var_os("PRIVORA_BLESS").is_some() {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, &actual).unwrap();
    }
    let expected =
        std::fs::read_to_string(&path).expect("golden file missing: run with PRIVORA_BLESS=1");
    assert_eq!(actual, expected, "golden drifted; review and re-bless");
}

#[test]
fn scan_offsets_are_utf16_and_round_trip_through_redact() {
    for (_, text) in docs() {
        let v: Value = serde_json::from_str(&api::scan(&text, OPTS).unwrap()).unwrap();
        let mut last_end = 0;
        for f in v.as_array().unwrap() {
            let (s, e) = (
                f["start"].as_u64().unwrap() as usize,
                f["end"].as_u64().unwrap() as usize,
            );
            assert!(s >= last_end && s < e && e <= utf16_len(&text));
            last_end = e;
        }
    }
}

#[test]
fn finding_shape_is_stable() {
    let text = "NIK: 3174051509900001";
    let v: Value = serde_json::from_str(&api::scan(text, OPTS).unwrap()).unwrap();
    let f = &v[0];
    let mut keys: Vec<&str> = f.as_object().unwrap().keys().map(String::as_str).collect();
    keys.sort_unstable();
    assert_eq!(
        keys,
        ["confidence", "end", "kind", "reason", "start", "validation"]
    );
    assert_eq!(f["kind"], "NIK");
    assert_eq!(f["confidence"], "TINGGI");
    assert_eq!(f["validation"]["type"], "NIK_OK");
    assert_eq!(f["validation"]["gender"], "L");
    assert_eq!(f["validation"]["centuryAmbiguous"], false);
}

#[test]
fn version_lists_match_core() {
    let v: Value = serde_json::from_str(&api::version()).unwrap();
    assert_eq!(v["engine"], "privora-core");
    assert_eq!(v["schema"], 1);
    assert_eq!(v["kinds"].as_array().unwrap().len(), 9);
    assert_eq!(
        v["errors"],
        json!([
            "INVALID_INPUT",
            "INVALID_SPAN",
            "TOKEN_COLLISION",
            "TOO_LARGE"
        ])
    );
}

#[test]
fn typed_errors() {
    assert_eq!(api::scan("x", "not json"), Err(ApiError::InvalidInput));
    assert_eq!(
        api::scan("x", r#"{"referenceDate":{"year":2026,"month":13,"day":1}}"#),
        Err(ApiError::InvalidInput)
    );
    assert_eq!(
        api::scan(
            "x",
            r#"{"referenceDate":{"year":2026,"month":1,"day":1},"sensitivity":"X"}"#
        ),
        Err(ApiError::InvalidInput)
    );
    assert_eq!(
        api::scan(
            "x",
            r#"{"referenceDate":{"year":2026,"month":1,"day":1},"extra":1}"#
        ),
        Err(ApiError::InvalidInput)
    );
    assert_eq!(
        api::redact("abc", r#"[{"start":0,"end":9,"kind":null}]"#, "LABEL"),
        Err(ApiError::InvalidSpan)
    );
    assert_eq!(
        api::redact("abc", r#"[{"start":2,"end":1,"kind":null}]"#, "LABEL"),
        Err(ApiError::InvalidSpan)
    );
    assert_eq!(
        api::redact(
            "a\u{1F600}",
            r#"[{"start":2,"end":3,"kind":null}]"#,
            "LABEL"
        ),
        Err(ApiError::InvalidSpan)
    );
    assert_eq!(
        api::redact("abc", "[]", "NOPE"),
        Err(ApiError::InvalidInput)
    );
    assert_eq!(
        api::redact("abc", r#"[{"start":-1,"end":1,"kind":null}]"#, "LABEL"),
        Err(ApiError::InvalidInput)
    );
    assert_eq!(
        api::redact("abc", r#"[{"start":0,"end":1,"kind":"BOGUS"}]"#, "LABEL"),
        Err(ApiError::InvalidInput)
    );
    assert_eq!(
        api::tokenize("abc", r#"[{"start":0,"end":9,"kind":null}]"#),
        Err(ApiError::InvalidSpan)
    );
    assert_eq!(
        api::restore("abc", "{}", "STRICT"),
        Err(ApiError::InvalidInput)
    );
    assert_eq!(
        api::restore("abc", "[]", "LOOSE"),
        Err(ApiError::InvalidInput)
    );
}

#[test]
fn token_collision_is_reported() {
    let text = "[[NIK_1]] [[PRV-NIK_1]] 3174051509900001";
    let spans = r#"[{"start":24,"end":40,"kind":"NIK"}]"#;
    assert_eq!(api::tokenize(text, spans), Err(ApiError::TokenCollision));
}

#[test]
fn too_large_is_refused_without_work() {
    let big = "a".repeat(MAX_INPUT_BYTES + 1);
    assert_eq!(api::scan(&big, OPTS), Err(ApiError::TooLarge));
    assert_eq!(api::find_occurrences(&big, "a"), Err(ApiError::TooLarge));
    assert_eq!(api::redact("a", &big, "LABEL"), Err(ApiError::TooLarge));
}

#[test]
fn errors_never_echo_input() {
    let secret = "3174051509900001-SECRET";
    for r in [
        api::scan("x", secret),
        api::scan(
            "x",
            &format!(r#"{{"referenceDate":{{"year":"{secret}"}}}}"#),
        ),
        api::redact("x", &format!(r#"[{{"start":"{secret}"}}]"#), "LABEL"),
        api::restore("x", &format!(r#"[{{"token":"{secret}"}}]"#), "STRICT"),
    ] {
        let code = r.unwrap_err().code();
        assert!(
            !code.contains("SECRET") && code.chars().all(|c| c.is_ascii_uppercase() || c == '_')
        );
    }
}

/// Garbage in every argument of every function: must return, never panic.
#[test]
fn garbage_never_panics() {
    let mut x: u64 = 0x9E37_79B9_7F4A_7C15;
    let mut next = move || {
        x ^= x << 13;
        x ^= x >> 7;
        x ^= x << 17;
        x
    };
    let alphabet: Vec<char> =
        "0123456789 \n\t-.:+@[]{}\",NIKnikA_é\u{1F600}\u{FFFD}\u{0}[[]]start end kind"
            .chars()
            .collect();
    let s = |n: usize, next: &mut dyn FnMut() -> u64| -> String {
        (0..n)
            .map(|_| alphabet[(next() % alphabet.len() as u64) as usize])
            .collect()
    };
    for i in 0..400 {
        let (t, a, b) = (
            s(i % 80, &mut next),
            s(i % 40, &mut next),
            s(i % 40, &mut next),
        );
        let _ = api::scan(&t, &a);
        let _ = api::redact(&t, &a, &b);
        let _ = api::tokenize(&t, &a);
        let _ = api::restore(&t, &a, &b);
        let _ = api::find_occurrences(&t, &a);
        // plausible-looking but hostile spans
        let spans = format!(
            r#"[{{"start":{},"end":{},"kind":null}}]"#,
            next() % 90,
            next() % 90
        );
        let _ = api::redact(&t, &spans, "BLOK");
        let _ = api::tokenize(&t, &spans);
    }
}
