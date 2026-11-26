// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Vassel Goleyu
export type ClassValue = string | false | null | undefined;
export const cx = (...v: ClassValue[]): string => v.filter(Boolean).join(" ");
