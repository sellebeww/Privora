// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Vassel Goleyu
//! NIK validator tests: rules R1 to R4. All numbers are synthetic.
#![allow(
    clippy::arithmetic_side_effects,
    clippy::expect_used,
    clippy::indexing_slicing,
    clippy::unwrap_used
)]

use privora_core::Date;
use privora_core::nik::{Gender, NikError, validate_nik};

const TODAY: Date = Date::new(2026, 11, 25);

/// Build a NIK from its parts: PP KK CC, DDMMYY, serial.
fn nik(region: &str, ddmmyy: &str, serial: &str) -> String {
    format!("{region}{ddmmyy}{serial}")
}

fn ok(ddmmyy: &str) -> privora_core::nik::NikInfo {
    validate_nik(&nik("320173", ddmmyy, "0001"), TODAY).expect("valid")
}

fn err(ddmmyy: &str) -> NikError {
    validate_nik(&nik("320173", ddmmyy, "0001"), TODAY).expect_err("invalid")
}

#[test]
fn r3_valid_male() {
    let info = ok("150890");
    assert_eq!(info.province, 32);
    assert_eq!(info.gender, Gender::Male);
    assert_eq!(info.birth_candidates, vec![Date::new(1990, 8, 15)]);
    assert!(!info.century_ambiguous);
}

#[test]
fn r3_valid_female_subtracts_40() {
    let info = ok("550890");
    assert_eq!(info.gender, Gender::Female);
    assert_eq!(info.birth_candidates, vec![Date::new(1990, 8, 15)]);
}

#[test]
fn r3_day_41_is_female_day_1_and_day_71_is_female_day_31() {
    assert_eq!(ok("410190").gender, Gender::Female);
    assert_eq!(ok("710390").birth_candidates, vec![Date::new(1990, 3, 31)]);
}

#[test]
fn r3_nonexistent_dates_31_feb_and_30_feb() {
    for dd in ["31", "30", "71", "70"] {
        assert_eq!(err(&format!("{dd}0290")), NikError::InvalidDate, "{dd}");
    }
}

#[test]
fn r3_29_feb_in_non_leap_year_both_centuries() {
    // 1905 and 2005 are both non-leap.
    assert_eq!(err("290205"), NikError::InvalidDate);
    // 1901/2001 too (1901 is also older than 120 years at TODAY).
    assert_eq!(err("290201"), NikError::InvalidDate);
}

#[test]
fn r3_29_feb_2000_is_leap_but_1900_is_not() {
    let info = ok("290200");
    assert_eq!(info.birth_candidates, vec![Date::new(2000, 2, 29)]);
    assert!(!info.century_ambiguous);
}

#[test]
fn r3_29_feb_leap_in_both_centuries_is_ambiguous() {
    // Reference 2010: 1904 (age 105) and 2004 are both leap and both plausible.
    let info = validate_nik(&nik("320173", "290204", "0001"), Date::new(2010, 1, 1)).unwrap();
    assert_eq!(
        info.birth_candidates,
        vec![Date::new(1904, 2, 29), Date::new(2004, 2, 29)]
    );
    assert!(info.century_ambiguous);
}

#[test]
fn r3_month_00_and_13_rejected() {
    assert_eq!(err("150090"), NikError::InvalidDate);
    assert_eq!(err("151390"), NikError::InvalidDate);
    assert_eq!(err("159990"), NikError::InvalidDate);
}

#[test]
fn r3_day_00_32_to_40_and_72_up_rejected() {
    assert_eq!(err("000890"), NikError::InvalidDate);
    for dd in 32..=40 {
        assert_eq!(err(&format!("{dd:02}0890")), NikError::InvalidDate, "{dd}");
    }
    for dd in 72..=99 {
        assert_eq!(err(&format!("{dd:02}0890")), NikError::InvalidDate, "{dd}");
    }
}

#[test]
fn r3_thirty_day_month_rejects_day_31() {
    assert_eq!(err("310490"), NikError::InvalidDate);
    assert!(validate_nik(&nik("320173", "300490", "0001"), TODAY).is_ok());
}

#[test]
fn r3_future_dates_are_dropped_against_reference_date() {
    // yy=27: 2027 is after TODAY, only 1927 survives.
    let info = ok("150827");
    assert_eq!(info.birth_candidates, vec![Date::new(1927, 8, 15)]);
    assert!(!info.century_ambiguous);
    // Same day as the reference date is allowed, the day after is not.
    let today = ok("251126");
    assert_eq!(
        today.birth_candidates,
        vec![Date::new(1926, 11, 25), Date::new(2026, 11, 25)]
    );
    assert!(today.century_ambiguous);
    assert_eq!(ok("261126").birth_candidates, vec![Date::new(1926, 11, 26)]);
}

#[test]
fn r3_every_candidate_in_the_future_is_invalid() {
    // Reference 1999-12-31: 29 Feb 1900 does not exist and 29 Feb 2000 is in the future.
    let r = validate_nik(&nik("320173", "290200", "0001"), Date::new(1999, 12, 31));
    assert_eq!(r, Err(NikError::InvalidDate));
    // 1 Jan 00 at the same reference: only 1900 is valid.
    let r = validate_nik(&nik("320173", "010100", "0001"), Date::new(1999, 12, 31)).unwrap();
    assert_eq!(r.birth_candidates, vec![Date::new(1900, 1, 1)]);
}

#[test]
fn r3_age_over_120_rejected_exact_boundary() {
    // TODAY is 2026-11-25. Born 1905-11-26 is 120 (birthday tomorrow of the 121st): valid.
    let a = ok("261105");
    assert_eq!(
        a.birth_candidates,
        vec![Date::new(1905, 11, 26), Date::new(2005, 11, 26)]
    );
    // Born 1905-11-25 is already 121: only 2005 remains.
    let b = ok("251105");
    assert_eq!(b.birth_candidates, vec![Date::new(2005, 11, 25)]);
    // Born 1905-08-15 is 121.
    assert_eq!(ok("150805").birth_candidates, vec![Date::new(2005, 8, 15)]);
}

#[test]
fn r3_century_ambiguous_flag() {
    let amb = ok("150820");
    assert_eq!(
        amb.birth_candidates,
        vec![Date::new(1920, 8, 15), Date::new(2020, 8, 15)]
    );
    assert!(amb.century_ambiguous);
    let not = ok("150890");
    assert!(!not.century_ambiguous);
}

#[test]
fn r1_unknown_province_rejected() {
    for p in ["00", "10", "20", "30", "37", "41", "99", "90", "97"] {
        let n = nik(&format!("{p}0101"), "150890", "0001");
        assert_eq!(
            validate_nik(&n, TODAY),
            Err(NikError::UnknownProvince),
            "{p}"
        );
    }
}

#[test]
fn r1_every_known_province_accepted_including_new_papua() {
    let known = [
        11, 12, 13, 14, 15, 16, 17, 18, 19, 21, 31, 32, 33, 34, 35, 36, 51, 52, 53, 61, 62, 63, 64,
        65, 71, 72, 73, 74, 75, 76, 81, 82, 91, 92, 93, 94, 95, 96,
    ];
    for p in known {
        let n = nik(&format!("{p}0101"), "150890", "0001");
        assert_eq!(validate_nik(&n, TODAY).unwrap().province, p);
    }
}

#[test]
fn r2_zero_kabupaten_or_kecamatan_rejected() {
    assert_eq!(
        validate_nik(&nik("320001", "150890", "0001"), TODAY),
        Err(NikError::ZeroRegency)
    );
    assert_eq!(
        validate_nik(&nik("320100", "150890", "0001"), TODAY),
        Err(NikError::ZeroRegency)
    );
    assert_eq!(
        validate_nik(&nik("320000", "150890", "0001"), TODAY),
        Err(NikError::ZeroRegency)
    );
}

#[test]
fn r4_zero_serial_rejected() {
    assert_eq!(
        validate_nik(&nik("320173", "150890", "0000"), TODAY),
        Err(NikError::ZeroSerial)
    );
    assert!(validate_nik(&nik("320173", "150890", "0001"), TODAY).is_ok());
}

#[test]
fn rule_order_is_r1_then_r2_then_r3_then_r4() {
    // Everything wrong: province reported first.
    assert_eq!(
        validate_nik(&nik("990000", "991390", "0000"), TODAY),
        Err(NikError::UnknownProvince)
    );
    assert_eq!(
        validate_nik(&nik("320000", "991390", "0000"), TODAY),
        Err(NikError::ZeroRegency)
    );
    assert_eq!(
        validate_nik(&nik("320173", "991390", "0000"), TODAY),
        Err(NikError::InvalidDate)
    );
}

#[test]
fn malformed_input_is_rejected_not_panicking() {
    for s in [
        "",
        "123",
        "320173150890000",
        "32017315089000012",
        "32017315089000AB",
        "3201731508900001 ",
        "٣٢٠١٧٣١٥٠٨٩٠٠٠٠١٢", // Arabic-Indic digits are not ASCII digits
        "32017315089000😀",
    ] {
        assert_eq!(validate_nik(s, TODAY), Err(NikError::Malformed), "{s:?}");
    }
}

/// SplitMix64: tiny deterministic PRNG so the estimate needs no dependency.
struct SplitMix(u64);
impl SplitMix {
    fn next(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^ (z >> 31)
    }
}

/// SINTETIS. Empirical false-accept rate of NIK validation on uniformly random 16 digit
/// strings. The exact figure is copied into docs/EVALUATION.md. Seed and reference date are fixed.
#[test]
fn empirical_random_16_digit_pass_rate() {
    const N: u32 = 100_000;
    let mut rng = SplitMix(0x5052_4956_4F52_4131); // "PRIVORA1"
    let mut pass = 0u32;
    for _ in 0..N {
        let mut s = String::with_capacity(16);
        for _ in 0..16 {
            s.push(char::from(b'0' + (rng.next() % 10) as u8));
        }
        if validate_nik(&s, TODAY).is_ok() {
            pass += 1;
        }
    }
    println!("EMPIRICAL random 16 digits passing NIK validation: {pass} of {N}");
    // Band is set after measuring (see docs/EVALUATION.md); a rule change that moves it must be explained.
    assert!(
        (EXPECTED_PASS_LO..=EXPECTED_PASS_HI).contains(&pass),
        "pass = {pass}"
    );
}

const EXPECTED_PASS_LO: u32 = 2500; // measured 2761 (2.761 percent)
const EXPECTED_PASS_HI: u32 = 3000;
