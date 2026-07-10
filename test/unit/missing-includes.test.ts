import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { missingIncludes } from '../../lib/sources.ts'

// A fixture base with a `root` source dir holding a couple of real entries.
let base: string
before(() => {
  base = mkdtempSync(join(tmpdir(), 'srvkit-missing-'))
  mkdirSync(join(base, 'root', 'configs'), { recursive: true })
  writeFileSync(join(base, 'root', '.bashrc'), '')
  writeFileSync(join(base, 'root', 'configs', 'app.conf'), '')
})
after(() => rmSync(base, { recursive: true, force: true }))

test('returns only the includes that no longer exist', () => {
  const includes = ['.bashrc', 'configs', 'compose.yml', 'nocodb/docker-compose.yml']
  assert.deepEqual(missingIncludes(base, 'root', includes), [
    'compose.yml',
    'nocodb/docker-compose.yml',
  ])
})

test('all-present yields an empty list; order is preserved for the missing', () => {
  assert.deepEqual(missingIncludes(base, 'root', ['.bashrc', 'configs/app.conf']), [])
  assert.deepEqual(missingIncludes(base, 'root', ['z-gone', 'a-gone']), ['z-gone', 'a-gone'])
})

test('a path escaping the base is treated as missing', () => {
  assert.deepEqual(missingIncludes(base, 'root', ['../../etc/passwd']), ['../../etc/passwd'])
})

test('a directory include that still exists is not missing', () => {
  assert.deepEqual(missingIncludes(base, 'root', ['configs']), [])
})
