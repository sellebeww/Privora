// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Vassel Goleyu
//! Precision and recall per kind on the synthetic corpus. Every number produced here is SINTETIS.

use privora_core::{Finding, Kind, ScanOptions, scan};

use crate::{Doc, REFERENCE_DATE};

pub const KINDS: [Kind; 9] = [
    Kind::Nik,
    Kind::Kk,
    Kind::Npwp,
    Kind::Phone,
    Kind::Email,
    Kind::Card,
    Kind::Name,
    Kind::Address,
    Kind::BirthDate,
];

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Counts {
    pub gold: usize,
    pub pred: usize,
    /// Gold spans with a prediction of the same kind and exactly the same range.
    pub gold_exact: usize,
    /// Predictions of this kind equal to a gold span of this kind.
    pub pred_exact: usize,
    /// Gold spans intersected by a prediction of the same kind.
    pub gold_overlap: usize,
    /// Predictions intersecting a gold span of the same kind.
    pub pred_overlap: usize,
    /// Gold spans fully covered by the union of all findings, whatever their kind (leak check).
    pub covered: usize,
}

fn ratio(n: usize, d: usize) -> Option<f64> {
    (d > 0).then(|| n as f64 / d as f64)
}

impl Counts {
    pub fn recall_exact(&self) -> Option<f64> {
        ratio(self.gold_exact, self.gold)
    }
    pub fn precision_exact(&self) -> Option<f64> {
        ratio(self.pred_exact, self.pred)
    }
    pub fn recall_overlap(&self) -> Option<f64> {
        ratio(self.gold_overlap, self.gold)
    }
    pub fn precision_overlap(&self) -> Option<f64> {
        ratio(self.pred_overlap, self.pred)
    }
    pub fn recall_covered(&self) -> Option<f64> {
        ratio(self.covered, self.gold)
    }
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct NegCounts {
    pub total: usize,
    /// Some finding of any kind intersects the negative.
    pub flagged: usize,
    /// Some NIK finding intersects the negative.
    pub flagged_nik: usize,
}

#[derive(Clone, Debug, Default)]
pub struct Report {
    pub docs: usize,
    pub rows: Vec<(&'static str, Counts)>,
    /// Name recall split by whether a label stood before the value (recall columns only).
    pub name_labeled: Counts,
    pub name_unlabeled: Counts,
    pub negatives: Vec<(&'static str, NegCounts)>,
}

impl Report {
    pub fn row(&self, kind: Kind) -> &Counts {
        static EMPTY: Counts = Counts {
            gold: 0,
            pred: 0,
            gold_exact: 0,
            pred_exact: 0,
            gold_overlap: 0,
            pred_overlap: 0,
            covered: 0,
        };
        self.rows
            .iter()
            .find(|(l, _)| *l == kind.label())
            .map_or(&EMPTY, |(_, c)| c)
    }

    /// Rate of random 16 digit strings flagged as NIK.
    pub fn random16_as_nik(&self) -> Option<f64> {
        self.negatives
            .iter()
            .find(|(c, _)| *c == "acak16")
            .and_then(|(_, n)| ratio(n.flagged_nik, n.total))
    }
}

fn overlaps(a: (usize, usize), b: (usize, usize)) -> bool {
    a.0 < b.1 && b.0 < a.1
}

/// Disjoint, merged (touching ranges joined) coverage of all findings.
fn merged(f: &[Finding]) -> Vec<(usize, usize)> {
    let mut v: Vec<(usize, usize)> = f.iter().map(|x| (x.start, x.end)).collect();
    v.sort();
    let mut out: Vec<(usize, usize)> = vec![];
    for (s, e) in v {
        match out.last_mut() {
            Some(l) if s <= l.1 => l.1 = l.1.max(e),
            _ => out.push((s, e)),
        }
    }
    out
}

fn add_gold(c: &mut Counts, g: (usize, usize), preds: &[(usize, usize)], cover: &[(usize, usize)]) {
    c.gold += 1;
    c.gold_exact += usize::from(preds.contains(&g));
    c.gold_overlap += usize::from(preds.iter().any(|p| overlaps(*p, g)));
    c.covered += usize::from(cover.iter().any(|(s, e)| *s <= g.0 && g.1 <= *e));
}

fn units_slice(text: &str, s: usize, e: usize) -> String {
    let u: Vec<u16> = text.encode_utf16().collect();
    String::from_utf16_lossy(u.get(s..e).unwrap_or_default())
}

/// Human readable misses (`MISS`) and false alarms (`FALSE`) of one document.
pub fn explain(d: &Doc) -> Vec<String> {
    let found = scan(&d.text, &ScanOptions::new(REFERENCE_DATE));
    let mut out = vec![];
    for f in &found {
        let hit = d
            .gold
            .iter()
            .any(|g| g.kind == f.kind && g.start == f.start && g.end == f.end);
        if !hit {
            let near = d
                .gold
                .iter()
                .any(|g| g.kind == f.kind && overlaps((g.start, g.end), (f.start, f.end)));
            out.push(format!(
                "{} {} {:?} [{}] reason={}",
                f.kind.label(),
                if near { "RANGE" } else { "FALSE" },
                units_slice(&d.text, f.start, f.end),
                f.confidence_name(),
                f.reason
            ));
        }
    }
    for g in &d.gold {
        if !found
            .iter()
            .any(|f| f.kind == g.kind && overlaps((g.start, g.end), (f.start, f.end)))
        {
            out.push(format!(
                "{} MISS {:?}",
                g.kind.label(),
                units_slice(&d.text, g.start, g.end)
            ));
        }
    }
    out
}

trait ConfName {
    fn confidence_name(&self) -> &'static str;
}
impl ConfName for Finding {
    fn confidence_name(&self) -> &'static str {
        match self.confidence {
            privora_core::Confidence::Tinggi => "TINGGI",
            privora_core::Confidence::Sedang => "SEDANG",
            privora_core::Confidence::Rendah => "RENDAH",
        }
    }
}

pub fn evaluate(docs: &[Doc]) -> Report {
    let mut rows: Vec<(&'static str, Counts)> = KINDS
        .iter()
        .map(|k| (k.label(), Counts::default()))
        .collect();
    let (mut name_l, mut name_u) = (Counts::default(), Counts::default());
    let mut negs: Vec<(&'static str, NegCounts)> = vec![];
    for d in docs {
        let found = scan(&d.text, &ScanOptions::new(REFERENCE_DATE));
        let cover = merged(&found);
        for (k, (_, c)) in KINDS.iter().zip(rows.iter_mut()) {
            let preds: Vec<(usize, usize)> = found
                .iter()
                .filter(|f| f.kind == *k)
                .map(|f| (f.start, f.end))
                .collect();
            let golds: Vec<(usize, usize)> = d
                .gold
                .iter()
                .filter(|g| g.kind == *k)
                .map(|g| (g.start, g.end))
                .collect();
            c.pred += preds.len();
            c.pred_exact += preds.iter().filter(|p| golds.contains(p)).count();
            c.pred_overlap += preds
                .iter()
                .filter(|p| golds.iter().any(|g| overlaps(**p, *g)))
                .count();
            for g in &golds {
                add_gold(c, *g, &preds, &cover);
            }
            if *k == Kind::Name {
                for g in d.gold.iter().filter(|g| g.kind == Kind::Name) {
                    add_gold(
                        if g.labeled { &mut name_l } else { &mut name_u },
                        (g.start, g.end),
                        &preds,
                        &cover,
                    );
                }
            }
        }
        for n in &d.neg {
            let i = match negs.iter().position(|(c, _)| *c == n.category) {
                Some(i) => i,
                None => {
                    negs.push((n.category, NegCounts::default()));
                    negs.len() - 1
                }
            };
            let hits: Vec<&Finding> = found
                .iter()
                .filter(|f| overlaps((f.start, f.end), (n.start, n.end)))
                .collect();
            let c = &mut negs[i].1;
            c.total += 1;
            c.flagged += usize::from(!hits.is_empty());
            c.flagged_nik += usize::from(hits.iter().any(|f| f.kind == Kind::Nik));
        }
    }
    negs.sort_by_key(|(c, _)| *c);
    Report {
        docs: docs.len(),
        rows,
        name_labeled: name_l,
        name_unlabeled: name_u,
        negatives: negs,
    }
}

fn pct(x: Option<f64>) -> String {
    x.map_or_else(|| "n/a".to_string(), |v| format!("{:.1}%", v * 100.0))
}

/// Markdown block for docs/EVALUATION.md.
pub fn markdown(title: &str, seed: u64, r: &Report) -> String {
    let mut s = format!(
        "### {title} (SINTETIS)\n\nSeed `{seed:#018x}`, {} documents, reference date 2026-11-25, sensitivity SEIMBANG. All numbers are SINTETIS.\n\n",
        r.docs
    );
    s.push_str("| Kind | Gold | Predicted | Precision (exact) | Recall (exact) | Precision (overlap) | Recall (overlap) | Gold fully covered by any finding |\n|---|---|---|---|---|---|---|---|\n");
    for (l, c) in &r.rows {
        s.push_str(&format!(
            "| {l} | {} | {} | {} | {} | {} | {} | {} |\n",
            c.gold,
            c.pred,
            pct(c.precision_exact()),
            pct(c.recall_exact()),
            pct(c.precision_overlap()),
            pct(c.recall_overlap()),
            pct(c.recall_covered())
        ));
    }
    for (l, c) in [
        ("NAMA, with label", &r.name_labeled),
        ("NAMA, no label", &r.name_unlabeled),
    ] {
        s.push_str(&format!(
            "| {l} (recall only) | {} | | | {} | | {} | {} |\n",
            c.gold,
            pct(c.recall_exact()),
            pct(c.recall_overlap()),
            pct(c.recall_covered())
        ));
    }
    s.push_str("\nHard negatives (text that looks like personal data but is not):\n\n| Category | Count | Flagged by any finding | Flagged as NIK |\n|---|---|---|---|\n");
    for (c, n) in &r.negatives {
        s.push_str(&format!(
            "| {c} | {} | {} ({}) | {} |\n",
            n.total,
            n.flagged,
            pct(ratio(n.flagged, n.total)),
            n.flagged_nik
        ));
    }
    s.push_str(&format!(
        "\nRandom 16 digit strings flagged as NIK (`acak16`): **{}**.\n",
        pct(r.random16_as_nik())
    ));
    s
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::Gold;

    fn doc(text: &str, gold: Vec<Gold>) -> Doc {
        Doc {
            id: "t".into(),
            split: "dev",
            template: "t",
            text: text.into(),
            gold,
            neg: vec![],
        }
    }

    #[test]
    fn counts_exact_overlap_and_coverage() {
        // email exact, phone partly found (as a different range), card missing
        let text = "a@b.com 0812 3456 7890 x";
        let gold = vec![
            Gold {
                kind: Kind::Email,
                start: 0,
                end: 7,
                labeled: false,
            },
            Gold {
                kind: Kind::Phone,
                start: 8,
                end: 21,
                labeled: false,
            },
            Gold {
                kind: Kind::Card,
                start: 23,
                end: 24,
                labeled: false,
            },
        ];
        let r = evaluate(&[doc(text, gold)]);
        let e = r.row(Kind::Email);
        assert_eq!(
            (e.gold, e.pred, e.gold_exact, e.pred_exact, e.covered),
            (1, 1, 1, 1, 1)
        );
        let p = r.row(Kind::Phone);
        assert_eq!(
            (p.gold, p.gold_exact, p.gold_overlap, p.covered),
            (1, 0, 1, 1)
        );
        let c = r.row(Kind::Card);
        assert_eq!((c.gold, c.gold_overlap, c.covered), (1, 0, 0));
    }

    #[test]
    fn merged_joins_touching_ranges() {
        let f = |s, e| Finding {
            kind: Kind::Nik,
            start: s,
            end: e,
            confidence: privora_core::Confidence::Tinggi,
            reason: "x",
            validation: None,
            overlaps: false,
        };
        assert_eq!(merged(&[f(0, 2), f(2, 5), f(7, 9)]), vec![(0, 5), (7, 9)]);
    }

    #[test]
    fn ratio_of_nothing_is_none() {
        assert_eq!(Counts::default().recall_exact(), None);
        assert_eq!(pct(None), "n/a");
    }
}
