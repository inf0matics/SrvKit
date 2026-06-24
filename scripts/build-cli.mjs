/**
 * Bundle the `srvkit` CLI into a single self-contained ESM file alongside the
 * Nitro server output. The runtime Docker image copies only `.output` (no
 * node_modules), so the CLI's deps (bcryptjs, bip39) must be inlined. The
 * node:sqlite builtin stays external.
 */
import { build } from 'esbuild'

await build({
  entryPoints: ['cli/srvkit.ts'],
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'esm',
  outfile: '.output/bin/srvkit.mjs',
  banner: { js: '#!/usr/bin/env node' },
})

console.log('▸ bundled CLI → .output/bin/srvkit.mjs')
