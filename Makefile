# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Vassel Goleyu
SHELL := /bin/bash
# Repo-local tools (.tools) win over system ones; both are optional.
export PATH := $(CURDIR)/.tools/bin:$(CURDIR)/.tools/binaryen/bin:$(HOME)/.cargo/bin:$(PATH)

# make resolves bare commands with its start-up PATH, so pick tool paths explicitly.
WASM_BINDGEN := $(or $(wildcard $(CURDIR)/.tools/bin/wasm-bindgen),wasm-bindgen)
WASM_OPT := $(or $(wildcard $(CURDIR)/.tools/binaryen/bin/wasm-opt),wasm-opt)
# Build time for anything that would embed one (nothing is known to): the last commit, not the clock.
export SOURCE_DATE_EPOCH ?= $(or $(shell git -C $(CURDIR) log -1 --format=%ct 2>/dev/null),0)

.PHONY: verify rust wasm web check-network check-ui repro ui-e2e corpus eval clean

verify: rust wasm web check-network check-ui

rust:
	cargo fmt --check
	cargo clippy --workspace --all-targets -- -D warnings
	cargo test --workspace

wasm:
	WASM_BINDGEN="$(WASM_BINDGEN)" WASM_OPT="$(WASM_OPT)" scripts/build-wasm.sh

web:
	pnpm -C web lint
	pnpm -C web typecheck
	pnpm -C web test
	pnpm -C web build

corpus:
	cargo run -q --release -p corpus-gen -- gen --out-dir target/corpus

# Regenerates the results block of docs/EVALUATION.md (dev and test seeds, all SINTETIS).
eval:
	cargo run -q --release -p corpus-gen -- eval --update docs/EVALUATION.md

check-network:
	node scripts/check-no-network.mjs

# Design token scan, contrast and a look inside dist/ (needs a prior `make web`).
check-ui:
	node scripts/check-tokens.mjs
	node scripts/check-contrast.mjs > /dev/null
	node scripts/check-dist.mjs

# Two clean builds in different directories, compared file by file.
repro:
	WASM_BINDGEN="$(WASM_BINDGEN)" WASM_OPT="$(WASM_OPT)" scripts/repro-check.sh

# Browser tests for components and pages (not part of verify: needs Chromium, see README, Build).
ui-e2e:
	PLAYWRIGHT_BROWSERS_PATH=$(CURDIR)/web/e2e/.browsers pnpm -C web ui:e2e

clean:
	cargo clean
	rm -rf web/dist web/src/wasm/pkg
