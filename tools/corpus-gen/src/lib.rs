// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Vassel Goleyu
//! Synthetic labelled corpus. Every name, address and number is invented; NIKs are
//! built from a structure that passes the validator and are NOT real identities.

pub mod docs;
pub mod eval;
pub mod rng;

use privora_core::{Date, Kind};

/// "Today" for the corpus and for the evaluation (the core never reads the clock).
pub const REFERENCE_DATE: Date = Date::new(2026, 11, 25);
/// Seeds are separate: rules are tuned on `DEV_SEED` only; `TEST_SEED` is reported once.
pub const DEV_SEED: u64 = 0x5052_4956_4F52_4144; // "PRIVORAD"
pub const TEST_SEED: u64 = 0x5052_4956_4F52_4154; // "PRIVORAT"
pub const DOCS_PER_SPLIT: usize = 400;

/// A true span. Offsets are UTF-16 code units, `end` exclusive.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Gold {
    pub kind: Kind,
    pub start: usize,
    pub end: usize,
    /// A label such as `Nama:` or a keyword sits right before the value.
    pub labeled: bool,
}

/// A hard negative: text that looks like personal data but is not.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Neg {
    pub category: &'static str,
    pub start: usize,
    pub end: usize,
}

#[derive(Clone, Debug)]
pub struct Doc {
    pub id: String,
    pub split: &'static str,
    pub template: &'static str,
    pub text: String,
    pub gold: Vec<Gold>,
    pub neg: Vec<Neg>,
}

fn esc(s: &str) -> String {
    let mut o = String::with_capacity(s.len() + 2);
    o.push('"');
    for c in s.chars() {
        match c {
            '"' => o.push_str("\\\""),
            '\\' => o.push_str("\\\\"),
            '\n' => o.push_str("\\n"),
            '\r' => o.push_str("\\r"),
            '\t' => o.push_str("\\t"),
            c if (c as u32) < 0x20 => o.push_str(&format!("\\u{:04x}", c as u32)),
            c => o.push(c),
        }
    }
    o.push('"');
    o
}

impl Doc {
    /// One JSON Lines record.
    pub fn to_json(&self) -> String {
        let gold: Vec<String> = self
            .gold
            .iter()
            .map(|g| {
                format!(
                    "{{\"kind\":{},\"start\":{},\"end\":{},\"labeled\":{}}}",
                    esc(g.kind.label()),
                    g.start,
                    g.end,
                    g.labeled
                )
            })
            .collect();
        let neg: Vec<String> = self
            .neg
            .iter()
            .map(|n| {
                format!(
                    "{{\"category\":{},\"start\":{},\"end\":{}}}",
                    esc(n.category),
                    n.start,
                    n.end
                )
            })
            .collect();
        format!(
            "{{\"id\":{},\"split\":{},\"template\":{},\"synthetic\":true,\"text\":{},\"labels\":[{}],\"negatives\":[{}]}}",
            esc(&self.id),
            esc(self.split),
            esc(self.template),
            esc(&self.text),
            gold.join(","),
            neg.join(",")
        )
    }
}
