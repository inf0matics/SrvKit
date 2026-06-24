import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { changePassword } from '../../cli/srvkit.ts'
import { openStore } from '../../lib/store.ts'
import { verifyPassword } from '../../lib/password.ts'

const CLI = fileURLToPath(new URL('../../cli/srvkit.ts', import.meta.url))
let dbPath = ''

function freshDb(label: string): string {
  dbPath = join(tmpdir(), `srvkit-cli-${process.pid}-${label}.db`)
  // changePassword() (in-process) reads the path from the environment.
  process.env.DATABASE_PATH = dbPath
  return dbPath
}

afterEach(() => {
  if (dbPath) {
    for (const suffix of ['', '-wal', '-shm']) rmSync(dbPath + suffix, { force: true })
  }
})

test('changePassword stores a hash that verifies', () => {
  const path = freshDb('verify')
  changePassword('correct horse battery staple')
  const s = openStore(path) // reopen — simulates the server process
  assert.ok(s.isInitialized())
  assert.ok(verifyPassword('correct horse battery staple', s.getPasswordHash()))
  s.close()
}, { concurrency: false })

test('changePassword rotates the session secret', () => {
  const path = freshDb('rotate')
  const before = (() => {
    const s = openStore(path)
    const sec = s.getSessionSecret()
    s.close()
    return sec
  })()
  changePassword('new passphrase')
  const s = openStore(path)
  assert.notEqual(s.getSessionSecret(), before)
  s.close()
})

test('changePassword rejects an empty password', () => {
  freshDb('empty')
  assert.throws(() => changePassword(''))
  assert.throws(() => changePassword('   '))
})

test('CLI exits 0 and confirms on success', () => {
  const path = freshDb('cli-ok')
  const out = execFileSync('node', [CLI, 'change-password', 'word1 word2 word3'], {
    env: { ...process.env, DATABASE_PATH: path },
    encoding: 'utf8',
  })
  assert.match(out, /Password updated\. All sessions invalidated\./)
})

test('CLI exits 1 on empty password', () => {
  freshDb('cli-empty')
  assert.throws(() =>
    execFileSync('node', [CLI, 'change-password', ''], {
      env: { ...process.env, DATABASE_PATH: dbPath },
      stdio: 'pipe',
    }),
  )
})

test('CLI exits 1 on unknown command', () => {
  assert.throws(() =>
    execFileSync('node', [CLI, 'bogus'], { stdio: 'pipe' }),
  )
})
