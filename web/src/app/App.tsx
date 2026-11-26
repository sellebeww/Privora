// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Vassel Goleyu
import type { Engine } from "../engine/engine";
import { useState, useSyncExternalStore } from "react";
import { CLEARED_ROUTE, SessionProvider } from "../flow/session";
import { PdfProvider } from "../pdf/session";
import { ToastProvider } from "../ui";
import { detectFeatures, isSupported } from "./features";
import { Help } from "./Help";
import { Home } from "./Home";
import { Shell } from "./Shell";
import { Restore } from "./Restore";
import { Unsupported } from "./States";
import { PdfWorkspace } from "./PdfWorkspace";
import { Workspace } from "./Workspace";

const subscribe = (cb: () => void) => {
  addEventListener("hashchange", cb);
  return () => removeEventListener("hashchange", cb);
};
const route = () => location.hash.replace(/^#\/?/, "").split("/")[0] ?? "";

export function App({ engine }: { engine?: Engine }) {
  const [features] = useState(() => detectFeatures());
  const r = useSyncExternalStore(subscribe, route, () => "");
  return (
    <ToastProvider>
      <SessionProvider engine={engine}>
      <PdfProvider>
      <Shell>
        {!isSupported(features) ? (
          <div className="p-6"><Unsupported features={features} /></div>
        ) : r === "bantuan" ? (
          <Help />
        ) : r === "pulihkan" ? (
          <Restore />
        ) : r === "pdf" ? (
          <PdfWorkspace />
        ) : r === "ruang-kerja" ? (
          <Workspace />
        ) : (
          <Home cleared={r === CLEARED_ROUTE} />
        )}
      </Shell>
      </PdfProvider>
      </SessionProvider>
    </ToastProvider>
  );
}
