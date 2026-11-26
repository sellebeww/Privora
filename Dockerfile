# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Vassel Goleyu
# Builds web/dist with pinned versions. Usage (writes the build to ./out):
#   docker build --build-arg SOURCE_DATE_EPOCH="$(git log -1 --format=%ct)" --output out .
#   node scripts/hash-dist.mjs out
FROM node:25.2.1-bookworm-slim@sha256:9b0d2dd3a55e1d10c1b17f0d1e8835b04965c7251ad65de0df67252d4a6f0159 AS node

FROM rust:1.99.1-bookworm@sha256:e6f2cff35d0f309acf8433b4f05878ed77092602c5065cc81801177da0bb3a9c AS build
ARG SOURCE_DATE_EPOCH=0
ARG TARGETARCH
ENV SOURCE_DATE_EPOCH=$SOURCE_DATE_EPOCH
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/npm
RUN node /usr/local/lib/node_modules/npm/bin/npm-cli.js install --global pnpm@10.34.9
# binaryen version_133, checked against the SHA-256 published with the release.
RUN set -eu; \
    case "$TARGETARCH" in \
      amd64) arch=x86_64; sum=2dc9c7813f5375db93d96ead4b78222fcc3e2677bbb832297af4797782a37489 ;; \
      arm64) arch=aarch64; sum=89c07ea56faf38d0fbecf36ca8ec0721756716185f265b568e133d427f299bf8 ;; \
      *) echo "unsupported architecture: $TARGETARCH" >&2; exit 1 ;; \
    esac; \
    curl -fsSL -o /tmp/binaryen.tar.gz "https://github.com/WebAssembly/binaryen/releases/download/version_133/binaryen-version_133-$arch-linux.tar.gz"; \
    echo "$sum  /tmp/binaryen.tar.gz" | sha256sum -c -; \
    mkdir -p /opt/binaryen; tar xzf /tmp/binaryen.tar.gz -C /opt/binaryen --strip-components=1; rm /tmp/binaryen.tar.gz
RUN cargo install wasm-bindgen-cli --version 0.2.130 --locked --root /opt/wasm-bindgen

WORKDIR /src
COPY rust-toolchain.toml ./
RUN rustup show active-toolchain || rustup toolchain install
COPY . .
RUN pnpm -C web install --frozen-lockfile \
 && WASM_BINDGEN=/opt/wasm-bindgen/bin/wasm-bindgen WASM_OPT=/opt/binaryen/bin/wasm-opt scripts/build-wasm.sh \
 && pnpm -C web build \
 && node scripts/check-no-network.mjs \
 && node scripts/check-dist.mjs \
 && node scripts/hash-dist.mjs web/dist

FROM scratch AS dist
COPY --from=build /src/web/dist /
