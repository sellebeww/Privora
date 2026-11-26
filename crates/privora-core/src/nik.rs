// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Vassel Goleyu
//! NIK structure validator. Pure function: the reference date
//! is a parameter. There is no check digit in a NIK, so a valid structure is not proof of
//! existence.

use crate::provinces::is_province;
use crate::types::Date;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Gender {
    Male,
    Female,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct NikInfo {
    pub province: u8,
    pub gender: Gender,
    /// Valid birth dates, ascending. One or two entries (19YY and/or 20YY).
    pub birth_candidates: Vec<Date>,
    /// Both centuries produce a valid date.
    pub century_ambiguous: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NikError {
    /// Not exactly 16 ASCII digits.
    Malformed,
    /// R1.
    UnknownProvince,
    /// R2: kabupaten/kota or kecamatan is `00`.
    ZeroRegency,
    /// R3.
    InvalidDate,
    /// R4.
    ZeroSerial,
}

/// Maximum age, in years, at the reference date.
const MAX_AGE: i32 = 120;

pub fn is_leap(year: i32) -> bool {
    (year % 4 == 0 && year % 100 != 0) || year % 400 == 0
}

pub fn days_in_month(year: i32, month: u8) -> u8 {
    match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if is_leap(year) => 29,
        2 => 28,
        _ => 0,
    }
}

/// Age in whole years at `today` for a birth date no later than `today`.
fn age_at(birth: Date, today: Date) -> i32 {
    let before_birthday = (today.month, today.day) < (birth.month, birth.day);
    today
        .year
        .saturating_sub(birth.year)
        .saturating_sub(i32::from(before_birthday))
}

fn candidate_ok(birth: Date, today: Date) -> bool {
    birth.month >= 1
        && birth.month <= 12
        && birth.day >= 1
        && birth.day <= days_in_month(birth.year, birth.month)
        && birth <= today
        && age_at(birth, today) <= MAX_AGE
}

fn two(b: &[u8], i: usize) -> Option<u8> {
    let hi = b.get(i)?.checked_sub(b'0').filter(|d| *d < 10)?;
    let lo = b
        .get(i.checked_add(1)?)?
        .checked_sub(b'0')
        .filter(|d| *d < 10)?;
    hi.checked_mul(10)?.checked_add(lo)
}

/// Validate a 16 digit NIK string (no separators). Rules are checked in the order R1, R2, R3, R4
/// and the first failure is reported.
pub fn validate_nik(digits: &str, today: Date) -> Result<NikInfo, NikError> {
    let b = digits.as_bytes();
    if b.len() != 16 || !b.iter().all(u8::is_ascii_digit) {
        return Err(NikError::Malformed);
    }
    let field = |i| two(b, i).ok_or(NikError::Malformed);
    let province = field(0)?;
    if !is_province(province) {
        return Err(NikError::UnknownProvince);
    }
    if field(2)? == 0 || field(4)? == 0 {
        return Err(NikError::ZeroRegency);
    }
    let (dd, mm, yy) = (field(6)?, field(8)?, field(10)?);
    let (gender, day) = if dd > 40 {
        (Gender::Female, dd.saturating_sub(40))
    } else {
        (Gender::Male, dd)
    };
    let birth_candidates: Vec<Date> = [1900i32, 2000]
        .iter()
        .map(|c| Date::new(c.saturating_add(i32::from(yy)), mm, day))
        .filter(|d| candidate_ok(*d, today))
        .collect();
    if birth_candidates.is_empty() {
        return Err(NikError::InvalidDate);
    }
    if b.get(12..16) == Some(b"0000") {
        return Err(NikError::ZeroSerial);
    }
    Ok(NikInfo {
        province,
        gender,
        century_ambiguous: birth_candidates.len() == 2,
        birth_candidates,
    })
}

/// Province code of a string that starts with two ASCII digits and is in the table.
pub(crate) fn known_province(digits: &str) -> Option<u8> {
    two(digits.as_bytes(), 0).filter(|p| is_province(*p))
}
