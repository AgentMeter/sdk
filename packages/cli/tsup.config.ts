import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node22',
  clean: true,
  dts: true,
  sourcemap: true,
  // node:sqlite is experimental and not in esbuild's built-in list, so we mark
  // it as external explicitly to prevent the node: prefix from being stripped.
  external: ['node:sqlite'],
  banner: {
    js: '#!/usr/bin/env node',
  },
});
