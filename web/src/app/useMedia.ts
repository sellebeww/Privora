// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Vassel Goleyu
import { useSyncExternalStore } from "react";

/** Live `matchMedia` match; false where matchMedia does not exist (tests, SSR). */
export function useMedia(query: string): boolean {
  return useSyncExternalStore(
    (cb) => {
      const m = typeof matchMedia === "function" ? matchMedia(query) : null;
      m?.addEventListener("change", cb);
      return () => m?.removeEventListener("change", cb);
    },
    () => (typeof matchMedia === "function" ? matchMedia(query).matches : false),
    () => false,
  );
}
