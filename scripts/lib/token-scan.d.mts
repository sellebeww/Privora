// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Vassel Goleyu
export interface Violation {
  rule: string;
  text: string;
  line: number;
}
export function scanSource(source: string, file?: string): Violation[];
export function scanSvg(text: string, tokenHexes: Set<string>): Violation[];
