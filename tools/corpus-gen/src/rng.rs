// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Vassel Goleyu
//! SplitMix64: tiny deterministic generator, so no `rand` dependency.

pub struct Rng(u64);

impl Rng {
    /// Independent stream per `(seed, index)`.
    pub fn new(seed: u64, index: u64) -> Self {
        let mut r = Rng(seed ^ index.wrapping_mul(0x9E37_79B9_7F4A_7C15));
        r.next_u64();
        r
    }

    pub fn next_u64(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^ (z >> 31)
    }

    /// Uniform in `lo..=hi`.
    pub fn range(&mut self, lo: u64, hi: u64) -> u64 {
        lo + self.next_u64() % (hi - lo + 1)
    }

    /// True with probability `percent` / 100.
    pub fn chance(&mut self, percent: u64) -> bool {
        self.next_u64() % 100 < percent
    }

    pub fn pick<'a, T: ?Sized>(&mut self, items: &[&'a T]) -> &'a T {
        items[(self.next_u64() % items.len() as u64) as usize]
    }

    pub fn digits(&mut self, n: usize) -> String {
        (0..n)
            .map(|_| char::from(b'0' + (self.next_u64() % 10) as u8))
            .collect()
    }
}
