// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Vassel Goleyu
//! Tokenisation and restore. All values are synthetic.
#![allow(
    clippy::arithmetic_side_effects,
    clippy::expect_used,
    clippy::indexing_slicing,
    clippy::unwrap_used
)]

use privora_core::{Kind, RestoreMode, Span, TokenMap, TokenizeError, find_all, restore, tokenize};
use proptest::prelude::*;

fn sp(start: usize, end: usize, kind: Option<Kind>) -> Span {
    Span { start, end, kind }
}

/// Spans for every exact occurrence of `needle`.
fn spans_of(text: &str, needle: &str, kind: Kind) -> Vec<Span> {
    find_all(text, needle)
        .into_iter()
        .map(|(s, e)| sp(s, e, Some(kind)))
        .collect()
}

fn roundtrip(text: &str, spans: &[Span]) {
    let t = tokenize(text, spans).unwrap();
    for mode in [RestoreMode::Strict, RestoreMode::Tolerant] {
        let (back, _) = restore(&t.text, &t.map, mode);
        assert_eq!(back, text, "{mode:?}");
    }
}

#[test]
fn same_value_same_token_different_value_different_token_numbered_by_first_appearance() {
    let t = "A 111 B 222 C 111 D 333";
    let mut spans = spans_of(t, "111", Kind::Nik);
    spans.extend(spans_of(t, "222", Kind::Nik));
    spans.extend(spans_of(t, "333", Kind::Phone));
    let out = tokenize(t, &spans).unwrap();
    assert_eq!(
        out.text,
        "A [[NIK_1]] B [[NIK_2]] C [[NIK_1]] D [[TELEPON_1]]"
    );
    assert_eq!(
        out.map.entries(),
        [
            ("[[NIK_1]]".to_string(), "111".to_string()),
            ("[[NIK_2]]".to_string(), "222".to_string()),
            ("[[TELEPON_1]]".to_string(), "333".to_string()),
        ]
    );
    roundtrip(t, &spans);
}

#[test]
fn token_numbers_are_per_kind() {
    let t = "n1 e1 n2 e2";
    let spans = [
        sp(0, 2, Some(Kind::Nik)),
        sp(3, 5, Some(Kind::Email)),
        sp(6, 8, Some(Kind::Nik)),
        sp(9, 11, Some(Kind::Email)),
    ];
    assert_eq!(
        tokenize(t, &spans).unwrap().text,
        "[[NIK_1]] [[EMAIL_1]] [[NIK_2]] [[EMAIL_2]]"
    );
}

#[test]
fn manual_spans_get_data_tokens_and_birth_date_name() {
    let t = "xx yy";
    assert_eq!(
        tokenize(t, &[sp(0, 2, None)]).unwrap().text,
        "[[DATA_1]] yy"
    );
    assert_eq!(
        tokenize("1990", &[sp(0, 4, Some(Kind::BirthDate))])
            .unwrap()
            .text,
        "[[TGL_LAHIR_1]]"
    );
}

#[test]
fn edge_whitespace_is_trimmed_out_of_the_value_and_stays_in_the_text() {
    let t = "a  111  b 111 c";
    let out = tokenize(t, &[sp(1, 8, Some(Kind::Nik)), sp(9, 13, Some(Kind::Nik))]).unwrap();
    assert_eq!(out.text, "a  [[NIK_1]]  b [[NIK_1]] c");
    assert_eq!(out.map.entries().len(), 1);
    assert_eq!(out.map.entries()[0].1, "111");
    roundtrip(t, &[sp(1, 8, Some(Kind::Nik)), sp(9, 13, Some(Kind::Nik))]);
    // a span of only whitespace produces nothing
    assert_eq!(tokenize("a   b", &[sp(1, 4, None)]).unwrap().text, "a   b");
}

#[test]
fn emails_differing_in_case_do_not_share_a_token_so_the_round_trip_stays_exact() {
    let t = "a@b.com A@B.com a@b.com";
    let spans = [
        sp(0, 7, Some(Kind::Email)),
        sp(8, 15, Some(Kind::Email)),
        sp(16, 23, Some(Kind::Email)),
    ];
    let out = tokenize(t, &spans).unwrap();
    assert_eq!(out.text, "[[EMAIL_1]] [[EMAIL_2]] [[EMAIL_1]]");
    roundtrip(t, &spans);
}

#[test]
fn overlapping_spans_are_merged_before_tokenising() {
    let t = "0123456789";
    let out = tokenize(t, &[sp(1, 5, Some(Kind::Nik)), sp(3, 8, None)]).unwrap();
    assert_eq!(out.text, "0[[NIK_1]]89");
    assert_eq!(out.map.entries()[0].1, "1234567");
}

#[test]
fn invalid_spans_are_rejected() {
    assert_eq!(
        tokenize("abc", &[sp(0, 9, None)]).unwrap_err(),
        TokenizeError::InvalidSpan
    );
    assert_eq!(
        tokenize("a\u{1F600}", &[sp(2, 3, None)]).unwrap_err(),
        TokenizeError::InvalidSpan
    );
}

#[test]
fn stable_across_runs() {
    let t = "a 1 b 2 a 1";
    let spans = [sp(2, 3, None), sp(6, 7, None), sp(10, 11, None)];
    let a = tokenize(t, &spans).unwrap();
    let b = tokenize(t, &spans).unwrap();
    assert_eq!(
        (a.text, a.map.entries().to_vec()),
        (b.text, b.map.entries().to_vec())
    );
}

// ---------- namespace collision ----------

#[test]
fn source_already_containing_a_token_switches_namespace() {
    let t = "lihat [[NIK_1]] dan 3201731508900001";
    let spans = spans_of(t, "3201731508900001", Kind::Nik);
    let out = tokenize(t, &spans).unwrap();
    assert_eq!(out.text, "lihat [[NIK_1]] dan [[PRV-NIK_1]]");
    assert_eq!(out.map.entries()[0].0, "[[PRV-NIK_1]]");
    roundtrip(t, &spans);
}

#[test]
fn lowercase_or_spaced_lookalikes_in_the_source_also_force_the_namespace_switch() {
    for look in ["[[nik_1]]", "[[ NIK_1 ]]", "[[Nik_1]]"] {
        let t = format!("{look} 3201731508900001");
        let spans = spans_of(&t, "3201731508900001", Kind::Nik);
        let out = tokenize(&t, &spans).unwrap();
        assert!(out.text.ends_with("[[PRV-NIK_1]]"), "{look}: {}", out.text);
        roundtrip(&t, &spans);
    }
}

#[test]
fn collision_is_judged_on_kept_text_only() {
    // the token-like string is the redacted value itself, so it is not in the output
    let t = "x [[NIK_1]] y";
    let out = tokenize(t, &[sp(2, 11, Some(Kind::Nik))]).unwrap();
    assert_eq!(out.text, "x [[NIK_1]] y");
    assert_eq!(out.map.entries()[0].1, "[[NIK_1]]");
    roundtrip(t, &[sp(2, 11, Some(Kind::Nik))]);
}

#[test]
fn unrelated_token_shapes_do_not_force_a_switch() {
    let t = "[[NIK_7]] 111";
    assert_eq!(
        tokenize(t, &[sp(10, 13, Some(Kind::Nik))]).unwrap().text,
        "[[NIK_7]] [[NIK_1]]"
    );
}

#[test]
fn both_namespaces_taken_is_a_clear_error() {
    let t = "[[NIK_1]] [[PRV-NIK_1]] 111";
    let err = tokenize(t, &[sp(24, 27, Some(Kind::Nik))]).unwrap_err();
    assert_eq!(err, TokenizeError::TokenCollision);
}

#[test]
fn no_spans_means_no_collision_check_failure() {
    let t = "[[NIK_1]] [[PRV-NIK_1]]";
    let out = tokenize(t, &[]).unwrap();
    assert_eq!(out.text, t);
    assert!(out.map.entries().is_empty());
}

#[test]
fn every_token_appears_once_per_occurrence_and_tokens_are_ascii() {
    let t = "1 2 1 3 2 1";
    let spans: Vec<Span> = ["1", "2", "3"]
        .iter()
        .flat_map(|n| spans_of(t, n, Kind::Nik))
        .collect();
    let out = tokenize(t, &spans).unwrap();
    assert!(out.text.is_ascii());
    assert_eq!(out.text.matches("[[NIK_1]]").count(), 3);
    assert_eq!(out.text.matches("[[NIK_2]]").count(), 2);
    assert_eq!(out.text.matches("[[NIK_3]]").count(), 1);
}

// ---------- restore ----------

fn map(pairs: &[(&str, &str)]) -> TokenMap {
    TokenMap::new(
        pairs
            .iter()
            .map(|(a, b)| (a.to_string(), b.to_string()))
            .collect(),
    )
}

#[test]
fn restore_strict_matches_exact_tokens_only_and_reports() {
    let m = map(&[
        ("[[NIK_1]]", "111"),
        ("[[EMAIL_1]]", "a@b.c"),
        ("[[NAMA_1]]", "Budi"),
    ]);
    let reply = "Halo [[NIK_1]], [[nik_1]], [[ NIK_1 ]], [[NIK_9]] dan [[NIK_1]] lagi";
    let (out, r) = restore(reply, &m, RestoreMode::Strict);
    assert_eq!(
        out,
        "Halo 111, [[nik_1]], [[ NIK_1 ]], [[NIK_9]] dan 111 lagi"
    );
    assert_eq!(r.restored, 2);
    assert!(r.flagged.is_empty());
    assert_eq!(r.unused, ["[[EMAIL_1]]", "[[NAMA_1]]"]);
    assert_eq!(r.unknown, ["[[nik_1]]", "[[ NIK_1 ]]", "[[NIK_9]]"]);
}

#[test]
fn restore_tolerant_accepts_case_and_inner_spaces_and_flags_them() {
    let m = map(&[("[[NIK_1]]", "111"), ("[[TGL_LAHIR_1]]", "x")]);
    let reply = "[[NIK_1]] [[nik_1]] [[ NIK_1 ]] [[Tgl_Lahir_1]] [[NIK_5]]";
    let (out, r) = restore(reply, &m, RestoreMode::Tolerant);
    assert_eq!(out, "111 111 111 x [[NIK_5]]");
    assert_eq!(r.restored, 4);
    assert_eq!(r.flagged.len(), 3);
    assert_eq!(r.flagged[0].found, "[[nik_1]]");
    assert_eq!((r.flagged[0].start, r.flagged[0].end), (10, 19));
    assert_eq!(r.unknown, ["[[NIK_5]]"]);
    assert!(r.unused.is_empty());
}

#[test]
fn restore_flag_offsets_are_utf16_of_the_input() {
    let m = map(&[("[[NIK_1]]", "111")]);
    let (_, r) = restore("\u{1F600} [[nik_1]]", &m, RestoreMode::Tolerant);
    assert_eq!((r.flagged[0].start, r.flagged[0].end), (3, 12));
}

#[test]
fn restored_values_are_not_rescanned() {
    let m = map(&[("[[NIK_1]]", "[[NIK_2]]"), ("[[NIK_2]]", "zzz")]);
    let (out, r) = restore("[[NIK_1]]", &m, RestoreMode::Strict);
    assert_eq!(out, "[[NIK_2]]");
    assert_eq!(r.restored, 1);
    assert_eq!(r.unused, ["[[NIK_2]]"]);
}

#[test]
fn restore_with_nothing_to_do_and_empty_map() {
    let (out, r) = restore("tidak ada token", &map(&[]), RestoreMode::Strict);
    assert_eq!(out, "tidak ada token");
    assert_eq!((r.restored, r.unused.len(), r.unknown.len()), (0, 0, 0));
    let (_, r) = restore("[[NIK_1]]", &map(&[]), RestoreMode::Strict);
    assert_eq!(r.unknown, ["[[NIK_1]]"]);
}

#[test]
fn unknown_list_is_deduplicated_in_order() {
    let (_, r) = restore("[[A_1]] [[B_1]] [[A_1]]", &map(&[]), RestoreMode::Strict);
    assert_eq!(r.unknown, ["[[A_1]]", "[[B_1]]"]);
}

#[test]
fn near_miss_shapes_are_not_token_like() {
    let m = map(&[]);
    for s in [
        "[NIK_1]",
        "[[NIK]]",
        "[[NIK_]]",
        "[[_1]]",
        "[[1_1]]",
        "[[NIK_1]",
        "[[ ]]",
        "[[NIK 1]]",
        "[[NIK_1x]]",
    ] {
        let (out, r) = restore(s, &m, RestoreMode::Tolerant);
        assert_eq!(out, s);
        assert!(r.unknown.is_empty(), "{s}: {:?}", r.unknown);
    }
}

#[test]
fn restore_tokens_with_prefix_namespace() {
    let t = "[[NIK_1]] 111";
    let out = tokenize(t, &[sp(10, 13, Some(Kind::Nik))]).unwrap();
    let (back, r) = restore(&out.text, &out.map, RestoreMode::Strict);
    assert_eq!(back, t);
    assert_eq!(r.restored, 1);
}

// ---------- property: the round trip invariant ----------

fn valid_bounds(units: &[u16]) -> Vec<usize> {
    (0..=units.len())
        .filter(|&i| !(i > 0 && i < units.len() && (0xDC00..0xE000).contains(&units[i])))
        .collect()
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(600))]

    #[test]
    fn restore_of_tokenize_is_identity(
        s in "([a-zA-Z0-9 \n\u{e9}\u{1F600}@.\\[\\]_-]|\\[\\[NIK_1\\]\\]|\\[\\[PRV-NIK_1\\]\\]|\\[\\[ nik_2 \\]\\]|\\[\\[DATA_3\\]\\]){0,60}",
        picks in proptest::collection::vec((0usize..1000, 0usize..1000, 0u8..4), 0..8),
    ) {
        let units: Vec<u16> = s.encode_utf16().collect();
        let b = valid_bounds(&units);
        let kinds = [None, Some(Kind::Nik), Some(Kind::Email), Some(Kind::Name)];
        let spans: Vec<Span> = picks.iter().map(|&(x, y, k)| {
            let (a, c) = (b[x % b.len()], b[y % b.len()]);
            sp(a.min(c), a.max(c), kinds[k as usize])
        }).collect();
        match tokenize(&s, &spans) {
            Ok(t) => {
                for mode in [RestoreMode::Strict, RestoreMode::Tolerant] {
                    let (back, _) = restore(&t.text, &t.map, mode);
                    prop_assert_eq!(&back, &s);
                }
                // tokens are unique per distinct value and values never appear in the output map twice
                let mut vals: Vec<&String> = t.map.entries().iter().map(|e| &e.1).collect();
                let n = vals.len();
                vals.sort(); vals.dedup();
                prop_assert_eq!(vals.len(), n);
            }
            Err(e) => prop_assert_eq!(e, TokenizeError::TokenCollision),
        }
    }

    #[test]
    fn restore_never_panics(s in any::<String>(), m in proptest::collection::vec((any::<String>(), any::<String>()), 0..4)) {
        let map = TokenMap::new(m);
        for mode in [RestoreMode::Strict, RestoreMode::Tolerant] {
            let _ = restore(&s, &map, mode);
        }
    }
}
