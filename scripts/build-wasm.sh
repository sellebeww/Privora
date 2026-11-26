#!/usr/bin/env bash
# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Vassel Goleyu
# Builds the wasm module into web/src/wasm/pkg with pinned tools and no machine paths in the output.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd -P)"
cd "$ROOT"
WASM_BINDGEN="${WASM_BINDGEN:-wasm-bindgen}"
WASM_OPT="${WASM_OPT:-wasm-opt}"
OUT=web/src/wasm/pkg
BINARYEN_WANT=133
# One source of truth for the wasm-bindgen version: the crate pin.
BINDGEN_WANT="$(sed -n 's/^wasm-bindgen = "=\([0-9.]*\)"$/\1/p' crates/privora-wasm/Cargo.toml)"

bindgen_have="$("$WASM_BINDGEN" --version)"
[ "$bindgen_have" = "wasm-bindgen $BINDGEN_WANT" ] || {
  echo "need wasm-bindgen $BINDGEN_WANT, found: $bindgen_have" >&2
  exit 1
}
opt_have="$("$WASM_OPT" --version)"
case "$opt_have" in
  "wasm-opt version $BINARYEN_WANT "* | "wasm-opt version $BINARYEN_WANT") ;;
  *)
    echo "need binaryen version_$BINARYEN_WANT, found: $opt_have" >&2
    exit 1
    ;;
esac

# Panic locations embed source paths. Later rules win, so general ones come first.
SYSROOT="$(rustc --print sysroot)"
COMMIT="$(rustc -vV | sed -n 's/^commit-hash: //p')"
flags=(
  "--remap-path-prefix=${CARGO_HOME:-$HOME/.cargo}=/cargo"
  "--remap-path-prefix=$SYSROOT=/rust"
  # With the rust-src component installed, std paths would point into the sysroot instead of /rustc/<commit>.
  "--remap-path-prefix=$SYSROOT/lib/rustlib/src/rust=/rustc/$COMMIT"
  "--remap-path-prefix=$ROOT=/privora"
)
CARGO_ENCODED_RUSTFLAGS="$(IFS=$'\x1f'; echo "${flags[*]}")"
export CARGO_ENCODED_RUSTFLAGS
export CARGO_TARGET_DIR="$ROOT/target"
export CARGO_INCREMENTAL=0

cargo build --locked --release --target wasm32-unknown-unknown -p privora-wasm
rm -rf "$OUT"
"$WASM_BINDGEN" --target web --out-dir "$OUT" --out-name privora target/wasm32-unknown-unknown/release/privora_wasm.wasm
# Explicit feature list, never --all-features: that flag made binaryen emit a module Node and older
# browsers cannot load (DECISIONS D-24). These are what rustc and wasm-bindgen output need.
"$WASM_OPT" -Oz --enable-bulk-memory --enable-sign-ext --enable-nontrapping-float-to-int --enable-mutable-globals \
  --enable-reference-types --enable-multivalue -o "$OUT/privora_bg.wasm" "$OUT/privora_bg.wasm"
echo "wasm raw bytes: $(wc -c <"$OUT/privora_bg.wasm" | tr -d ' ')"
echo "wasm gzip bytes: $(gzip -9 -n -c "$OUT/privora_bg.wasm" | wc -c | tr -d ' ')"
