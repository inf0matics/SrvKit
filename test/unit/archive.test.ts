import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { list } from 'tar'
import { createArchive } from '../../lib/archive.ts'

let base = ''
let src = ''

before(() => {
  base = mkdtempSync(join(tmpdir(), 'srvkit-archive-'))
  src = join(base, 'root')
  mkdirSync(join(src, 'configs'), { recursive: true })
  mkdirSync(join(src, 'cache'), { recursive: true })
  writeFileSync(join(src, '.bashrc'), 'x')
  writeFileSync(join(src, 'configs', 'app.conf'), 'x')
  writeFileSync(join(src, 'cache', 'junk.tmp'), 'x')
})

after(() => rmSync(base, { recursive: true, force: true }))

async function entries(file: string): Promise<string[]> {
  const found: string[] = []
  await list({ file, onentry: (e) => found.push(e.path.replace(/^\.\//, '')) })
  return found.filter((p) => p && !p.endsWith('/')).sort()
}

test('archives all files when nothing is excluded', async () => {
  const out = join(base, 'all.tgz')
  await createArchive(src, [], out)
  assert.deepEqual(await entries(out), [
    '.bashrc',
    'cache/junk.tmp',
    'configs/app.conf',
  ])
})

test('excludes a directory subtree and a single file', async () => {
  const out = join(base, 'partial.tgz')
  await createArchive(src, ['cache', 'configs/app.conf'], out)
  assert.deepEqual(await entries(out), ['.bashrc'])
})
