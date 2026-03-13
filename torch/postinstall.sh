#!/bin/sh
# Fix native module resolution on Android/Termux
# Rollup and esbuild don't ship android-arm64 binaries;
# the linux-arm64 builds work fine on Termux.

if [ "$(uname -o 2>/dev/null)" = "Android" ] || [ -d "/data/data/com.termux" ]; then
  # esbuild
  if [ -d "node_modules/@esbuild/linux-arm64" ] && [ ! -e "node_modules/@esbuild/android-arm64" ]; then
    ln -sf linux-arm64 node_modules/@esbuild/android-arm64
  fi

  # rollup: replace native with wasm build
  if [ -d "node_modules/@rollup/wasm-node/dist" ]; then
    cp -rf node_modules/@rollup/wasm-node/dist/* node_modules/rollup/dist/
  fi
fi
