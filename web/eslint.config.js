// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Vassel Goleyu
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";

export default tseslint.config(
  { ignores: ["public/pdfjs", "dist", "dist-engine-e2e", "src/wasm/pkg", "e2e/.browsers", "test-results"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  reactHooks.configs.flat.recommended,
  { files: ["src/offline/sw.js"], languageOptions: { globals: globals.serviceworker } },
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
  },
);
