import { test, beforeEach, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const base = mkdtempSync(join(tmpdir(), 'srvkit-host-'))
process.env.DATABASE_PATH = join(base, 'db.sqlite')
process.env.ENCRYPTION_KEY = 'host-key'
process.env.BACKUP_SOURCES_DIR = join(base, 'sources')

const { isValidHost } = await import('../../server/utils/backups.ts')

beforeEach(() => {
  delete process.env.ALLOW_PRIVATE_WEBDAV
})
after(() => {
  delete process.env.ALLOW_PRIVATE_WEBDAV
})

test('accepts public http(s) hosts', () => {
  assert.ok(isValidHost('https://nextcloud.example.com'))
  assert.ok(isValidHost('http://203.0.113.10:8080/dav'))
})

test('rejects loopback / private / link-local by default (SSRF)', () => {
  for (const h of [
    'http://localhost',
    'http://127.0.0.1',
    'http://10.1.2.3',
    'http://172.16.0.1',
    'http://172.31.255.1',
    'http://192.168.1.10',
    'http://169.254.169.254/latest/meta-data/', // cloud metadata
    'http://[::1]',
  ]) {
    assert.equal(isValidHost(h), false, h)
  }
})

test('rejects non-http(s) and malformed URLs', () => {
  assert.equal(isValidHost('ftp://example.com'), false)
  assert.equal(isValidHost('file:///etc/passwd'), false)
  assert.equal(isValidHost('not a url'), false)
  assert.equal(isValidHost(''), false)
})

test('ALLOW_PRIVATE_WEBDAV=1 opts out of the private-address block', () => {
  process.env.ALLOW_PRIVATE_WEBDAV = '1'
  assert.ok(isValidHost('http://127.0.0.1:1'))
  assert.ok(isValidHost('http://192.168.1.10'))
})

test('172.x outside the private /12 is still allowed', () => {
  assert.ok(isValidHost('http://172.15.0.1')) // below 172.16
  assert.ok(isValidHost('http://172.32.0.1')) // above 172.31
})
