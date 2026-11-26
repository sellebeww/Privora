#!/usr/bin/env bash
# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Vassel Goleyu
# Builds twice from clean copies in two different directories and compares the SHA-256 of every dist file.
# The second build also gets another CARGO_HOME, time zone and locale. Exit 0 only if everything matches.
# Needs: the pinned tools (see README) and a pnpm store or network. Usage: scripts/repro-check.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd -P)"
export PATH="$HOME/.cargo/bin:$PATH"
pick() { if [ -x "$ROOT/.tools/$1" ]; then echo "$ROOT/.tools/$1"; else command -v "${1##*/}"; fi; }
WASM_BINDGEN="${WASM_BINDGEN:-$(pick bin/wasm-bindgen || echo wasm-bindgen)}"
WASM_OPT="${WASM_OPT:-$(pick binaryen/bin/wasm-opt || echo wasm-opt)}"
# Make passes bare names when there is no repo-local copy.
missing() { echo "repro-check: $1 not found (see README, Build)" >&2; exit 1; }
case "$WASM_BINDGEN" in /*) ;; *) WASM_BINDGEN="$(command -v "$WASM_BINDGEN")" || missing wasm-bindgen ;; esac
case "$WASM_OPT" in /*) ;; *) WASM_OPT="$(command -v "$WASM_OPT")" || missing wasm-opt ;; esac
export WASM_BINDGEN WASM_OPT
export SOURCE_DATE_EPOCH="${SOURCE_DATE_EPOCH:-$(git -C "$ROOT" log -1 --format=%ct 2>/dev/null || echo 0)}"

WORK="$(cd "$(mktemp -d "${TMPDIR:-/tmp}/privora-repro.XXXXXX")" && pwd -P)"
trap 'rm -rf "$WORK"' EXIT
A="$WORK/a/privora"
B="$WORK/b-with-a-much-longer-directory-name/nested/checkout"
REAL_CARGO_HOME="${CARGO_HOME:-$HOME/.cargo}"
mkdir -p "$A" "$B" "$WORK/b-cargo-home"
# Same crate sources, different path: shows that CARGO_HOME does not leak into the output.
for d in registry git; do
  if [ -e "$REAL_CARGO_HOME/$d" ]; then ln -s "$REAL_CARGO_HOME/$d" "$WORK/b-cargo-home/$d"; fi
done

copy_sources() { # tracked and untracked files, never ignored ones (no target, node_modules, dist or .tools)
  (cd "$ROOT" && git ls-files -z --cached --others --exclude-standard |
    while IFS= read -r -d '' f; do if [ -e "$f" ]; then printf '%s\0' "$f"; fi; done |
    tar --null -T - -cf -) | tar -xf - -C "$1"
}

quietly() { # run, and show the output only if it fails
  "$@" >"$WORK/step.log" 2>&1 || {
    cat "$WORK/step.log" >&2
    return 1
  }
}

build() { # directory
  (
    cd "$1"
    quietly pnpm -C web install --frozen-lockfile --prefer-offline
    scripts/build-wasm.sh
    quietly pnpm -C web build
  )
}

hashes() { node "$ROOT/scripts/hash-dist.mjs" "$1/web/dist"; }

echo "tools: $(rustc --version) | $("$WASM_BINDGEN" --version) | $("$WASM_OPT" --version) | node $(node --version) | pnpm $(pnpm --version) | $(uname -sm)"
echo "SOURCE_DATE_EPOCH=$SOURCE_DATE_EPOCH"
copy_sources "$A"
copy_sources "$B"
echo "== build A: $A"
build "$A"
echo "== build B: $B"
(
  export CARGO_HOME="$WORK/b-cargo-home" TZ=Pacific/Kiritimati LC_ALL=C
  build "$B"
)

hashes "$A" >"$WORK/a.sha"
hashes "$B" >"$WORK/b.sha"
cat "$WORK/a.sha"
node "$ROOT/scripts/check-paths.mjs" "$A/web/dist" "$A" "$WORK"
node "$ROOT/scripts/check-paths.mjs" "$B/web/dist" "$B" "$WORK"
if diff "$WORK/a.sha" "$WORK/b.sha" >"$WORK/diff.txt"; then
  echo "repro-check: ok, both builds are identical. $(tail -1 "$WORK/a.sha")"
else
  echo "repro-check: FAILED, these files differ (< build A, > build B):" >&2
  cat "$WORK/diff.txt" >&2
  exit 1
fi
