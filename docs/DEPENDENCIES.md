# Dependencies and licences

Checked 2026-11-25 from each package's own `package.json`/LICENSE as installed (npm packages) or the
crates.io metadata (Rust). No GPL or AGPL anywhere in what ships. Only dependencies that are used are
installed. Nothing here loads from a CDN.

## Ships in the bundle

| Package | Version | Licence | Why |
|---|---|---|---|
| react, react-dom | 19.3.1 | MIT | UI |
| pdfjs-dist | 6.5.438 | Apache-2.0 | PDF text, positions and rasterisation, lazy loaded (only when a PDF is opened). Runtime assets copied by `scripts/prepare-pdfjs-assets.mjs` into `web/public/pdfjs` (not committed): `cmaps` (Adobe, BSD-3-Clause per the files), `standard_fonts` (Foxit and Liberation fonts, licence files `LICENSE_FOXIT`, `LICENSE_LIBERATION` travel with them), `wasm/` decoders `jbig2`, `openjpeg`, `qcms` with their `LICENSE_*` files. `quickjs-eval.*` is not copied. The Node build `pdfjs-dist/legacy` is used by tests only. |
| geist (fonts only) | 1.9.2 | SIL OFL 1.1 | Geist Sans and Mono, files bundled locally. OFL permits embedding and redistribution; the licence text must accompany the fonts. |
| wasm-bindgen (crate) | =0.2.130 | MIT OR Apache-2.0 | JS glue for the engine |
| serde, serde_json (crates, in the wasm) | 1.0.229, 1.0.154 | MIT OR Apache-2.0 | JSON across the wasm boundary. Transitive, from `cargo metadata`: serde_core, serde_derive (build time), itoa (MIT OR Apache-2.0), memchr 2.8.3 (Unlicense OR MIT), zmij 1.0.23 (MIT), and build-time syn, quote, proc-macro2, unicode-ident (MIT OR Apache-2.0, plus Unicode-3.0 for unicode-ident). No copyleft. |

## Build and test only

| Package | Version | Licence |
|---|---|---|
| vite | 8.3.8 | MIT |
| @vitejs/plugin-react | 6.3.0 | MIT |
| tailwindcss, @tailwindcss/vite | 4.3.5 | MIT |
| vitest | 5.1.1 | MIT |
| typescript | 6.0.3 | Apache-2.0 |
| eslint, @eslint/js | 10.15.0 / 10.0.1 | MIT |
| typescript-eslint | 8.74.0 | MIT |
| eslint-plugin-react-hooks, globals | 7.1.1 / 17.14.0 | MIT |
| @playwright/test | 1.65.1 | Apache-2.0 (browser tests; browser binaries are not committed) |
| axe-core | 4.14.1 | MPL-2.0 (browser accessibility audit in `e2e/audit-a11y.spec.ts`; unmodified, never shipped) |
| proptest (Rust dev-dependency of privora-core) | 1.12.0 | MIT OR Apache-2.0 |
| wasm-bindgen-cli, binaryen (wasm-opt) | 0.2.130, version_133 | MIT OR Apache-2.0, Apache-2.0 |

## Licence check

- Licence texts of everything that ships are in the build: `licenses.txt` and `pdfjs/**/LICENSE*`. Regenerate after a
  dependency change: `node scripts/gen-licenses.mjs`.
- No package in `cargo metadata` is copyleft only. No GPL, AGPL or LGPL package is installed on macOS arm64;
  `lightningcss` and `axe-core` (MPL-2.0) are build and test tools, `caniuse-lite` (CC-BY-4.0) is build data.
  Platform packages for other systems in the lockfile were not scanned.
