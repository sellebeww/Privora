// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Vassel Goleyu
//! Public data types. Offsets in `Finding` are UTF-16 code units (JavaScript string indices),
//! `end` exclusive.

use crate::nik::{NikError, NikInfo};

/// What a finding is. The derived order is the fixed tie-break order used for sorting.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum Kind {
    Nik,
    Kk,
    Npwp,
    Phone,
    Email,
    Card,
    Name,
    Address,
    BirthDate,
}

impl Kind {
    /// Upper-case ASCII name used in `[LABEL]` redaction and `[[LABEL_n]]` tokens.
    pub const fn label(self) -> &'static str {
        match self {
            Kind::Nik => "NIK",
            Kind::Kk => "KK",
            Kind::Npwp => "NPWP",
            Kind::Phone => "TELEPON",
            Kind::Email => "EMAIL",
            Kind::Card => "KARTU",
            Kind::Name => "NAMA",
            Kind::Address => "ALAMAT",
            Kind::BirthDate => "TGL_LAHIR",
        }
    }
}

/// Confidence of a finding. `Rendah < Sedang < Tinggi`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum Confidence {
    Rendah,
    Sedang,
    Tinggi,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub enum Sensitivity {
    /// Default.
    #[default]
    Seimbang,
    /// Every 16 digit run becomes at least a low confidence NIK candidate.
    HatiHati,
}

/// A calendar date. The field order makes the derived ordering chronological.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct Date {
    pub year: i32,
    pub month: u8,
    pub day: u8,
}

impl Date {
    pub const fn new(year: i32, month: u8, day: u8) -> Self {
        Self { year, month, day }
    }
}

#[derive(Clone, Copy, Debug)]
pub struct ScanOptions {
    pub sensitivity: Sensitivity,
    /// "Today" for NIK date rules. The core never reads the system clock.
    pub reference_date: Date,
}

impl ScanOptions {
    /// Default sensitivity (`Seimbang`) with the given reference date.
    pub const fn new(reference_date: Date) -> Self {
        Self {
            sensitivity: Sensitivity::Seimbang,
            reference_date,
        }
    }
}

/// Structural validation result attached to a finding, for the review panel only.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Validation {
    Nik(Result<NikInfo, NikError>),
    /// Luhn checksum passed.
    Luhn,
    /// Province code (first two digits) is in the table.
    Province(u8),
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Finding {
    pub kind: Kind,
    /// UTF-16 start, inclusive.
    pub start: usize,
    /// UTF-16 end, exclusive.
    pub end: usize,
    pub confidence: Confidence,
    /// Stable code for the UI. Never contains the value.
    pub reason: &'static str,
    pub validation: Option<Validation>,
    /// True when another candidate intersects this one. Resolved later by overlap resolution.
    pub overlaps: bool,
}
