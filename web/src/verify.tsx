// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Vassel Goleyu
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Shell } from "./app/Shell";
import { Verify } from "./app/Verify";
import { registerOffline } from "./offline/register";
import "./index.css";

const el = document.getElementById("root");
if (el) createRoot(el).render(<StrictMode><Shell><Verify /></Shell></StrictMode>);
registerOffline();
