// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Vassel Goleyu
export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}
export function parseColor(v: string): Rgba;
export function parseTokens(css: string): Record<string, string>;
export function over(fg: Rgba, bg: Rgba): Rgba;
export function luminance(c: Rgba): number;
export function ratio(a: Rgba, b: Rgba): number;
