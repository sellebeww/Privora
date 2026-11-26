// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Vassel Goleyu
//! Regression thresholds, SINTETIS. They are the real measured values on the TEST seed (see
//! docs/EVALUATION.md) rounded down to two decimals, so a detector change that loses accuracy
//! fails here. They are not goals and say nothing about real documents.

use corpus_gen::docs::corpus;
use corpus_gen::eval::{Report, evaluate};
use corpus_gen::{DOCS_PER_SPLIT, TEST_SEED};
use privora_core::Kind;

fn report() -> Report {
    evaluate(&corpus(TEST_SEED, "test", DOCS_PER_SPLIT))
}

fn at_least(what: &str, got: Option<f64>, min: f64) {
    let g = got.unwrap_or(0.0);
    assert!(g >= min, "{what}: {g:.4} < {min}");
}

#[test]
fn recall_does_not_regress() {
    let r = report();
    for k in [
        Kind::Nik,
        Kind::Kk,
        Kind::Npwp,
        Kind::Phone,
        Kind::Email,
        Kind::Card,
        Kind::BirthDate,
    ] {
        at_least(k.label(), r.row(k).recall_exact(), 1.00);
        at_least(k.label(), r.row(k).recall_covered(), 1.00);
    }
    at_least("ALAMAT exact", r.row(Kind::Address).recall_exact(), 0.97);
    at_least(
        "ALAMAT overlap",
        r.row(Kind::Address).recall_overlap(),
        1.00,
    );
    at_least(
        "ALAMAT covered",
        r.row(Kind::Address).recall_covered(),
        0.97,
    );
    at_least("NAMA with label", r.name_labeled.recall_exact(), 1.00);
}

#[test]
fn precision_does_not_regress() {
    let r = report();
    at_least("NIK", r.row(Kind::Nik).precision_exact(), 0.95);
    at_least("KK", r.row(Kind::Kk).precision_exact(), 1.00);
    at_least("NPWP", r.row(Kind::Npwp).precision_exact(), 0.96);
    at_least("TELEPON", r.row(Kind::Phone).precision_exact(), 0.99);
    at_least("EMAIL", r.row(Kind::Email).precision_exact(), 0.93);
    at_least("KARTU", r.row(Kind::Card).precision_exact(), 0.78);
    at_least("NAMA", r.row(Kind::Name).precision_exact(), 1.00);
    at_least("ALAMAT", r.row(Kind::Address).precision_overlap(), 1.00);
    at_least("TGL_LAHIR", r.row(Kind::BirthDate).precision_exact(), 1.00);
}

#[test]
fn random_16_digits_flagged_as_nik_stays_low() {
    let rate = report().random16_as_nik().unwrap();
    assert!(rate <= 0.06, "{rate}");
}

#[test]
fn there_is_no_unlabeled_name_detection() {
    // No name detection without a label. If this starts failing, the scope changed.
    assert_eq!(report().name_unlabeled.gold_overlap, 0);
}
