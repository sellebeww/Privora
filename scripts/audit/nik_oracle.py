# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Vassel Goleyu
"""Independent NIK validator, written from the written rules with Python's own calendar.

It shares no code with the Rust engine. All numbers are synthetic (SINTETIS). Usage:
  python3 scripts/audit/nik_oracle.py fixture        > web/src/engine/fixtures/nik_oracle.json
  python3 scripts/audit/nik_oracle.py random N SEED  > cases.json
"""

import calendar
import datetime as dt
import json
import random
import sys

PROVINCES = {
    11, 12, 13, 14, 15, 16, 17, 18, 19, 21,
    31, 32, 33, 34, 35, 36,
    51, 52, 53,
    61, 62, 63, 64, 65,
    71, 72, 73, 74, 75, 76,
    81, 82,
    91, 92, 93, 94, 95, 96,
}


def full_years(born: dt.date, today: dt.date) -> int:
    years = today.year - born.year
    if (today.month, today.day) < (born.month, born.day):
        years -= 1
    return years


def judge(nik: str, today: dt.date) -> dict:
    assert len(nik) == 16 and nik.isdigit()
    province, regency, district = int(nik[0:2]), int(nik[2:4]), int(nik[4:6])
    dd, mm, yy, serial = int(nik[6:8]), int(nik[8:10]), int(nik[10:12]), nik[12:]
    if province not in PROVINCES:  # R1
        return {"error": "UNKNOWN_PROVINCE"}
    if regency == 0 or district == 0:  # R2
        return {"error": "ZERO_REGENCY"}
    female = 41 <= dd <= 71  # R3
    if not (1 <= dd <= 31 or female):
        return {"error": "INVALID_DATE"}
    day = dd - 40 if female else dd
    born = []
    for century in (1900, 2000):
        year = century + yy
        if not 1 <= mm <= 12 or day > calendar.monthrange(year, mm)[1]:
            continue
        date = dt.date(year, mm, day)
        if date <= today and full_years(date, today) <= 120:
            born.append([date.year, date.month, date.day])
    if not born:
        return {"error": "INVALID_DATE"}
    if serial == "0000":  # R4
        return {"error": "ZERO_SERIAL"}
    return {"gender": "P" if female else "L", "born": born, "ambiguous": len(born) == 2}


def make(province=32, regency=1, district=1, dd=15, mm=5, yy=90, serial=1) -> str:
    return f"{province:02d}{regency:02d}{district:02d}{dd:02d}{mm:02d}{yy:02d}{serial:04d}"


def case(name: str, ref: str, nik: str) -> dict:
    today = dt.date.fromisoformat(ref)
    return {"name": name, "nik": nik, "today": [today.year, today.month, today.day], "expect": judge(nik, today)}


def fixture() -> list:
    now = "2026-11-26"
    rows = [
        # name, reference date, fields
        ("male ordinary", now, {}),
        ("female ordinary", now, {"dd": 55}),
        ("province 00", now, {"province": 0}),
        ("province 10 unused", now, {"province": 10}),
        ("province 20 gap", now, {"province": 20}),
        ("province 97 unused", now, {"province": 97}),
        ("province 93 Papua Selatan", now, {"province": 93}),
        ("province 96 Papua Barat Daya", now, {"province": 96}),
        ("regency 00", now, {"regency": 0}),
        ("district 00", now, {"district": 0}),
        ("day 00", now, {"dd": 0}),
        ("day 01", now, {"dd": 1}),
        ("day 31 in May", now, {"dd": 31}),
        ("day 32", now, {"dd": 32}),
        ("day 40", now, {"dd": 40}),
        ("day 41 female first", now, {"dd": 41}),
        ("day 71 female last", now, {"dd": 71}),
        ("day 72", now, {"dd": 72}),
        ("day 99", now, {"dd": 99}),
        ("month 00", now, {"mm": 0}),
        ("month 13", now, {"mm": 13}),
        ("31 April", now, {"dd": 31, "mm": 4}),
        ("30 April", now, {"dd": 30, "mm": 4}),
        ("30 February", now, {"dd": 30, "mm": 2}),
        ("29 Feb yy00: only 2000 is leap", now, {"dd": 29, "mm": 2, "yy": 0}),
        ("29 Feb yy04: both leap", now, {"dd": 29, "mm": 2, "yy": 4}),
        ("29 Feb yy01: none leap", now, {"dd": 29, "mm": 2, "yy": 1}),
        ("29 Feb yy28: 2028 is future", now, {"dd": 29, "mm": 2, "yy": 28}),
        ("female 29 Feb yy96", now, {"dd": 69, "mm": 2, "yy": 96}),
        ("born today", now, {"dd": 26, "mm": 11, "yy": 26}),
        ("born tomorrow is future, 1926 stays", now, {"dd": 27, "mm": 11, "yy": 26}),
        ("age 120, one day before turning 121", now, {"dd": 27, "mm": 11, "yy": 5}),
        ("exactly 121 today", now, {"dd": 26, "mm": 11, "yy": 5}),
        ("exactly 120 today", now, {"dd": 26, "mm": 11, "yy": 6}),
        ("both centuries valid", now, {"yy": 10}),
        ("serial 0000", now, {"serial": 0}),
        ("serial 9999", now, {"serial": 9999}),
        ("rule order R1 before R3", now, {"province": 0, "mm": 13, "serial": 0}),
        ("rule order R2 before R3", now, {"regency": 0, "mm": 13}),
        ("rule order R3 before R4", now, {"mm": 13, "serial": 0}),
        ("leap birthday, reference 28 Feb 2025", "2025-02-28", {"dd": 29, "mm": 2, "yy": 4}),
        ("leap birthday, reference 1 Mar 2025", "2025-03-01", {"dd": 29, "mm": 2, "yy": 4}),
        ("reference on a leap day, born that day", "2028-02-29", {"dd": 29, "mm": 2, "yy": 28}),
        ("reference on a leap day, 29 Feb 1908 is 120", "2028-02-29", {"dd": 29, "mm": 2, "yy": 8}),
        ("reference 31 Dec 1999", "1999-12-31", {"dd": 1, "mm": 1, "yy": 0}),
        ("reference 1 Jan 2000", "2000-01-01", {"dd": 1, "mm": 1, "yy": 0}),
        ("reference 29 Feb 2024, born 29 Feb 1904", "2024-02-29", {"dd": 29, "mm": 2, "yy": 4}),
    ]
    return [case(name, ref, make(**fields)) for name, ref, fields in rows]


def randoms(count: int, seed: int) -> list:
    rng = random.Random(seed)
    refs = ["2026-11-26", "2025-02-28", "2024-02-29", "2000-01-01", "2028-12-31"]
    out = []
    for i in range(count):
        if i % 4 == 0:
            nik = "".join(rng.choice("0123456789") for _ in range(16))
        else:  # biased towards the boundaries
            nik = make(
                province=rng.choice(sorted(PROVINCES) + [0, 10, 20, 37, 97, 99]),
                regency=rng.choice([0, 1, 71, 99]),
                district=rng.choice([0, 1, 50, 99]),
                dd=rng.choice([0, 1, 28, 29, 30, 31, 32, 40, 41, 68, 69, 70, 71, 72, rng.randrange(100)]),
                mm=rng.choice([0, 1, 2, 2, 2, 4, 11, 12, 13, rng.randrange(100)]),
                yy=rng.randrange(100),
                serial=rng.choice([0, 1, 9999, rng.randrange(10000)]),
            )
        out.append(case(f"random {i}", refs[i % len(refs)], nik))
    return out


if __name__ == "__main__":
    if sys.argv[1] == "fixture":
        print(json.dumps(fixture(), indent=1))
    else:
        print(json.dumps(randoms(int(sys.argv[2]), int(sys.argv[3]))))
