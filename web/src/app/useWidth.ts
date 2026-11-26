// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Vassel Goleyu
import { useCallback, useEffect, useState } from "react";

/**
 * Width in CSS pixels of an element, kept up to date. Returns `[width, ref]`: use the ref callback on the
 * element. It follows the element when it is replaced (a step that unmounts and mounts it again). 0 until measured.
 */
export function useWidth(): [number, (el: HTMLElement | null) => void] {
  const [el, setEl] = useState<HTMLElement | null>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    if (!el) return;
    const ro = new ResizeObserver(() => setW(Math.floor(el.getBoundingClientRect().width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  const ref = useCallback((node: HTMLElement | null) => setEl(node), []);
  return [w, ref];
}
