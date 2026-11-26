// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Vassel Goleyu
//! Pure functions behind the wasm exports. Structured values cross the boundary as JSON
//! strings (camelCase keys, upper-case enum words), text crosses as plain strings. Errors are
//! a closed set of codes: never free text, never a copy of user input.

use privora_core::nik::{Gender, NikError, NikInfo};
use privora_core::{
    Confidence, Date, Finding, Kind, RestoreMode, RestoreReport, ScanOptions, Sensitivity, Span,
    TokenMap, TokenizeError, Validation,
};
use serde::{Deserialize, Serialize};

/// Largest single input accepted, in bytes. Bigger inputs are refused instead of risking an
/// out-of-memory trap (a trap would take the whole wasm instance down).
pub const MAX_INPUT_BYTES: usize = 64 * 1024 * 1024;

/// Bump when a JSON shape changes. The TypeScript side checks it.
pub const SCHEMA_VERSION: u32 = 1;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ApiError {
    /// Malformed JSON, unknown field, wrong type, unknown word, impossible date.
    InvalidInput,
    /// A span is out of range, inverted, or cuts a surrogate pair.
    InvalidSpan,
    /// Both token namespaces already occur in the text.
    TokenCollision,
    /// An input is larger than [`MAX_INPUT_BYTES`].
    TooLarge,
}

impl ApiError {
    pub const ALL: [ApiError; 4] = [
        ApiError::InvalidInput,
        ApiError::InvalidSpan,
        ApiError::TokenCollision,
        ApiError::TooLarge,
    ];

    pub const fn code(self) -> &'static str {
        match self {
            ApiError::InvalidInput => "INVALID_INPUT",
            ApiError::InvalidSpan => "INVALID_SPAN",
            ApiError::TokenCollision => "TOKEN_COLLISION",
            ApiError::TooLarge => "TOO_LARGE",
        }
    }
}

type Res<T> = Result<T, ApiError>;

const ALL_KINDS: [Kind; 9] = [
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
const ALL_CONFIDENCES: [Confidence; 3] =
    [Confidence::Tinggi, Confidence::Sedang, Confidence::Rendah];

// Compile-time guards: a new `Kind` or `Confidence` variant breaks the build here, so the lists
// above (and the TypeScript mirror, checked by a test) cannot silently go stale.
const _: fn(Kind) = |k| match k {
    Kind::Nik
    | Kind::Kk
    | Kind::Npwp
    | Kind::Phone
    | Kind::Email
    | Kind::Card
    | Kind::Name
    | Kind::Address
    | Kind::BirthDate => {}
};
const _: fn(Confidence) = |c| match c {
    Confidence::Tinggi | Confidence::Sedang | Confidence::Rendah => {}
};

const fn confidence_word(c: Confidence) -> &'static str {
    match c {
        Confidence::Tinggi => "TINGGI",
        Confidence::Sedang => "SEDANG",
        Confidence::Rendah => "RENDAH",
    }
}

fn kind_from_label(label: &str) -> Res<Kind> {
    ALL_KINDS
        .into_iter()
        .find(|k| k.label() == label)
        .ok_or(ApiError::InvalidInput)
}

fn guard(parts: &[&str]) -> Res<()> {
    if parts.iter().any(|p| p.len() > MAX_INPUT_BYTES) {
        Err(ApiError::TooLarge)
    } else {
        Ok(())
    }
}

fn parse<'a, T: Deserialize<'a>>(json: &'a str) -> Res<T> {
    serde_json::from_str(json).map_err(|_| ApiError::InvalidInput)
}

fn to_json<T: Serialize>(v: &T) -> Res<String> {
    serde_json::to_string(v).map_err(|_| ApiError::InvalidInput)
}

// ---- input shapes -------------------------------------------------------------------------

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DateIn {
    year: i32,
    month: u8,
    day: u8,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ScanOptionsIn {
    /// `SEIMBANG` (default) or `HATI_HATI`.
    sensitivity: Option<String>,
    reference_date: DateIn,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SpanIn {
    start: usize,
    end: usize,
    /// Kind label (`NIK`, `TELEPON`, ...) or null for a manual selection.
    kind: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct EntryIo {
    token: String,
    value: String,
}

fn spans(json: &str) -> Res<Vec<Span>> {
    parse::<Vec<SpanIn>>(json)?
        .into_iter()
        .map(|s| {
            let kind = match s.kind {
                Some(l) => Some(kind_from_label(&l)?),
                None => None,
            };
            Ok(Span {
                start: s.start,
                end: s.end,
                kind,
            })
        })
        .collect()
}

fn scan_options(json: &str) -> Res<ScanOptions> {
    let o: ScanOptionsIn = parse(json)?;
    let d = o.reference_date;
    if !(1..=9999).contains(&d.year) || !(1..=12).contains(&d.month) || !(1..=31).contains(&d.day) {
        return Err(ApiError::InvalidInput);
    }
    let sensitivity = match o.sensitivity.as_deref() {
        None | Some("SEIMBANG") => Sensitivity::Seimbang,
        Some("HATI_HATI") => Sensitivity::HatiHati,
        Some(_) => return Err(ApiError::InvalidInput),
    };
    Ok(ScanOptions {
        sensitivity,
        reference_date: Date::new(d.year, d.month, d.day),
    })
}

// ---- output shapes ------------------------------------------------------------------------

#[derive(Serialize)]
struct DateOut {
    year: i32,
    month: u8,
    day: u8,
}

#[derive(Serialize)]
#[serde(
    tag = "type",
    rename_all = "SCREAMING_SNAKE_CASE",
    rename_all_fields = "camelCase"
)]
enum ValidationOut {
    NikOk {
        province: u8,
        /// `L` (laki-laki) or `P` (perempuan).
        gender: &'static str,
        birth_candidates: Vec<DateOut>,
        century_ambiguous: bool,
    },
    NikError {
        error: &'static str,
    },
    Luhn,
    Province {
        province: u8,
    },
}

#[derive(Serialize)]
struct FindingOut {
    kind: &'static str,
    start: usize,
    end: usize,
    confidence: &'static str,
    reason: &'static str,
    validation: Option<ValidationOut>,
}

fn nik_ok(i: NikInfo) -> ValidationOut {
    ValidationOut::NikOk {
        province: i.province,
        gender: match i.gender {
            Gender::Male => "L",
            Gender::Female => "P",
        },
        birth_candidates: i
            .birth_candidates
            .into_iter()
            .map(|d| DateOut {
                year: d.year,
                month: d.month,
                day: d.day,
            })
            .collect(),
        century_ambiguous: i.century_ambiguous,
    }
}

const fn nik_error_word(e: NikError) -> &'static str {
    match e {
        NikError::Malformed => "MALFORMED",
        NikError::UnknownProvince => "UNKNOWN_PROVINCE",
        NikError::ZeroRegency => "ZERO_REGENCY",
        NikError::InvalidDate => "INVALID_DATE",
        NikError::ZeroSerial => "ZERO_SERIAL",
    }
}

fn finding_out(f: Finding) -> FindingOut {
    FindingOut {
        kind: f.kind.label(),
        start: f.start,
        end: f.end,
        confidence: confidence_word(f.confidence),
        reason: f.reason,
        validation: f.validation.map(|v| match v {
            Validation::Nik(Ok(i)) => nik_ok(i),
            Validation::Nik(Err(e)) => ValidationOut::NikError {
                error: nik_error_word(e),
            },
            Validation::Luhn => ValidationOut::Luhn,
            Validation::Province(p) => ValidationOut::Province { province: p },
        }),
    }
}

#[derive(Serialize)]
struct EntryOut<'a> {
    token: &'a str,
    value: &'a str,
}

#[derive(Serialize)]
struct TokenizedOut<'a> {
    text: &'a str,
    map: Vec<EntryOut<'a>>,
}

#[derive(Serialize)]
struct FlagOut {
    start: usize,
    end: usize,
    found: String,
}

#[derive(Serialize)]
struct ReportOut {
    restored: usize,
    flagged: Vec<FlagOut>,
    unused: Vec<String>,
    unknown: Vec<String>,
}

#[derive(Serialize)]
struct RestoredOut {
    text: String,
    report: ReportOut,
}

#[derive(Serialize)]
struct RangeOut {
    start: usize,
    end: usize,
}

// ---- API ----------------------------------------------------------------------------------

/// JSON array of findings, sorted by `start`, no two intersecting. UTF-16 offsets, `end` exclusive.
pub fn scan(text: &str, options_json: &str) -> Res<String> {
    guard(&[text, options_json])?;
    let options = scan_options(options_json)?;
    let out: Vec<FindingOut> = privora_core::scan(text, &options)
        .into_iter()
        .map(finding_out)
        .collect();
    to_json(&out)
}

/// `style` is `LABEL` or `BLOK`. Returns the redacted text itself, not JSON.
pub fn redact(text: &str, spans_json: &str, style: &str) -> Res<String> {
    guard(&[text, spans_json])?;
    let style = match style {
        "LABEL" => privora_core::RedactStyle::Label,
        "BLOK" => privora_core::RedactStyle::Block,
        _ => return Err(ApiError::InvalidInput),
    };
    privora_core::redact(text, &spans(spans_json)?, style).map_err(|_| ApiError::InvalidSpan)
}

/// JSON `{text, map: [{token, value}]}`. The map holds personal data.
pub fn tokenize(text: &str, spans_json: &str) -> Res<String> {
    guard(&[text, spans_json])?;
    let t = privora_core::tokenize(text, &spans(spans_json)?).map_err(|e| match e {
        TokenizeError::InvalidSpan => ApiError::InvalidSpan,
        TokenizeError::TokenCollision => ApiError::TokenCollision,
    })?;
    let map = t
        .map
        .entries()
        .iter()
        .map(|(token, value)| EntryOut { token, value })
        .collect();
    to_json(&TokenizedOut { text: &t.text, map })
}

/// `mode` is `STRICT` or `TOLERANT`. JSON `{text, report}`.
pub fn restore(text: &str, map_json: &str, mode: &str) -> Res<String> {
    guard(&[text, map_json])?;
    let mode = match mode {
        "STRICT" => RestoreMode::Strict,
        "TOLERANT" => RestoreMode::Tolerant,
        _ => return Err(ApiError::InvalidInput),
    };
    let entries: Vec<EntryIo> = parse(map_json)?;
    let map = TokenMap::new(entries.into_iter().map(|e| (e.token, e.value)).collect());
    let (text, r): (String, RestoreReport) = privora_core::restore(text, &map, mode);
    to_json(&RestoredOut {
        text,
        report: ReportOut {
            restored: r.restored,
            flagged: r
                .flagged
                .into_iter()
                .map(|f| FlagOut {
                    start: f.start,
                    end: f.end,
                    found: f.found,
                })
                .collect(),
            unused: r.unused,
            unknown: r.unknown,
        },
    })
}

/// JSON array of `{start, end}`: exact, case sensitive, non overlapping.
pub fn find_occurrences(text: &str, needle: &str) -> Res<String> {
    guard(&[text, needle])?;
    let out: Vec<RangeOut> = privora_core::find_all(text, needle)
        .into_iter()
        .map(|(start, end)| RangeOut { start, end })
        .collect();
    to_json(&out)
}

/// JSON `{engine, version, schema, kinds, confidences, errors}`. The word lists let the
/// TypeScript side prove its own copies match this build.
pub fn version() -> String {
    #[derive(Serialize)]
    struct V {
        engine: &'static str,
        version: &'static str,
        schema: u32,
        kinds: Vec<&'static str>,
        confidences: Vec<&'static str>,
        errors: Vec<&'static str>,
    }
    let v = V {
        engine: privora_core::engine_name(),
        version: env!("CARGO_PKG_VERSION"),
        schema: SCHEMA_VERSION,
        kinds: ALL_KINDS.iter().map(|k| k.label()).collect(),
        confidences: ALL_CONFIDENCES
            .iter()
            .map(|c| confidence_word(*c))
            .collect(),
        errors: ApiError::ALL.iter().map(|e| e.code()).collect(),
    };
    // Serialising plain strings and numbers cannot fail; an empty object is the safe fallback.
    serde_json::to_string(&v).unwrap_or_else(|_| String::from("{}"))
}
