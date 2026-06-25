import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { listSources, buildTree } from '../../lib/sources.ts'

let base = ''

before(() => {
  base = mkdtempSync(join(tmpdir(), 'srvkit-sources-'))
  mkdirSync(join(base, 'root', 'configs'), { recursive: true })
  writeFileSync(join(base, 'root', '.bashrc'), 'x')
  writeFileSync(join(base, 'root', 'configs', 'app.conf'), 'x')
  mkdirSync(join(base, 'home'))
  writeFileSync(join(base, 'home', 'notes.txt'), 'x')
})

after(() => rmSync(base, { recursive: true, force: true }))

test('listSources returns sorted immediate sub-directories', () => {
  assert.deepEqual(listSources(base), ['home', 'root'])
})

test('listSources is empty for a missing base', () => {
  assert.deepEqual(listSources(join(base, 'does-not-exist')), [])
})

test('buildTree walks files and directories with relative paths', () => {
  const tree = buildTree(join(base, 'root'))
  // Directories first, then files (each alphabetical).
  assert.deepEqual(
    tree.map((n) => `${n.type}:${n.path}`),
    ['dir:configs', 'file:.bashrc'],
  )
  const configs = tree.find((n) => n.name === 'configs')!
  assert.deepEqual(configs.children, [
    { name: 'app.conf', path: 'configs/app.conf', type: 'file' },
  ])
})
