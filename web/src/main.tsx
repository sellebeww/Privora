// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Vassel Goleyu
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import { registerOffline } from "./offline/register";
import "./index.css";

const el = document.getElementById("root");
if (el) {
  const root = createRoot(el);
  // The component gallery exists only in the dev server: in a production build this branch is removed.
  if (import.meta.env.DEV && location.pathname === "/dev/ui") {
    void import("./dev/UiGallery").then(({ UiGallery }) => root.render(<StrictMode><UiGallery /></StrictMode>));
  } else {
    root.render(<StrictMode><App /></StrictMode>);
  }
}
registerOffline();
