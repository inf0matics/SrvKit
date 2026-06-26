import { test, before, beforeEach, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Configure the environment before importing modules that read it.
const base = mkdtempSync(join(tmpdir(), 'srvkit-alerts-'))
process.env.DATABASE_PATH = join(base, 'db.sqlite')
process.env.ENCRYPTION_KEY = 'alerts-test-key'
process.env.BACKUP_SOURCES_DIR = join(base, 'sources')
// Ensure env fallbacks don't leak a token into "unconfigured" cases.
delete process.env.TELEGRAM_BOT_TOKEN
delete process.env.TELEGRAM_CHAT_ID

const { store } = await import('../../server/utils/srvkit.ts')
const {
  saveAlertSettings,
  getAlertSettings,
  handleRunResult,
  buildFailedMessage,
  buildRecoveredMessage,
} = await import('../../server/utils/alerts.ts')

let jobId = ''
const realFetch = globalThis.fetch
let calls: { url: string; text: string }[] = []

function mockOk() {
  globalThis.fetch = (async (url: string, init: { body: string }) => {
    calls.push({ url: String(url), text: JSON.parse(init.body).text })
    return { ok: true, status: 200, json: async () => ({}) } as Response
  }) as typeof fetch
}

const run = (status: 'success' | 'failed', error: string | null = null) => ({
  at: '2026-06-25T03:12:44Z',
  status,
  error,
})

before(() => {
  const t = store().createTarget({
    name: 'nc',
    host: 'https://nc',
    username: 'u',
    password: 'p',
    rootDir: '',
  })
  jobId = store().createJob({
    targetId: t.id,
    name: 'App DB',
    type: 'sqlite',
    sourcePath: 'app.db',
    includes: [],
    output: 'single',
    subdirectory: '',
    dateSuffix: false,
    timeSuffix: false,
  }).id
})

beforeEach(() => {
  calls = []
  mockOk()
  // Reset to a known channel + state before each test.
  saveAlertSettings({ token: 'TKN', chatId: '123', enabled: true, recovery: true })
  store().setJobAlertState(jobId, 'ok')
  store().setJobMuted(jobId, false)
})

after(() => {
  globalThis.fetch = realFetch
  store().close()
  rmSync(base, { recursive: true, force: true })
})

test('settings persist; token is encrypted and never returned', () => {
  const s = getAlertSettings()
  assert.equal(s.chatId, '123')
  assert.equal(s.enabled, true)
  assert.equal(s.recovery, true)
  assert.equal(s.hasToken, true)
  assert.equal('token' in s, false)
})

test('OK → FAILED sends a failure alert and flips state', async () => {
  await handleRunResult(jobId, run('failed', 'Upload failed: connection timeout'))
  assert.equal(calls.length, 1)
  assert.match(calls[0]!.url, /api\.telegram\.org\/botTKN\/sendMessage$/)
  assert.match(calls[0]!.text, /Backup "App DB" failed/)
  assert.match(calls[0]!.text, /connection timeout/)
  assert.equal(store().getJob(jobId)?.alertState, 'failed')
})

test('FAILED → FAILED stays quiet (no spam)', async () => {
  store().setJobAlertState(jobId, 'failed')
  await handleRunResult(jobId, run('failed', 'still down'))
  assert.equal(calls.length, 0)
  assert.equal(store().getJob(jobId)?.alertState, 'failed')
})

test('FAILED → OK sends a recovery alert', async () => {
  store().setJobAlertState(jobId, 'failed')
  await handleRunResult(jobId, run('success'))
  assert.equal(calls.length, 1)
  assert.match(calls[0]!.text, /back to OK/)
  assert.equal(store().getJob(jobId)?.alertState, 'ok')
})

test('a muted job advances state but sends nothing', async () => {
  store().setJobMuted(jobId, true)
  await handleRunResult(jobId, run('failed', 'boom'))
  assert.equal(calls.length, 0)
  assert.equal(store().getJob(jobId)?.alertState, 'failed')
})

test('recovery disabled: state recovers without a message', async () => {
  saveAlertSettings({ recovery: false })
  store().setJobAlertState(jobId, 'failed')
  await handleRunResult(jobId, run('success'))
  assert.equal(calls.length, 0)
  assert.equal(store().getJob(jobId)?.alertState, 'ok')
})

test('channel disabled: state changes but nothing is sent', async () => {
  saveAlertSettings({ enabled: false })
  await handleRunResult(jobId, run('failed', 'boom'))
  assert.equal(calls.length, 0)
  assert.equal(store().getJob(jobId)?.alertState, 'failed')
})

test('message builders match the spec format', () => {
  assert.equal(
    buildFailedMessage('App DB', run('failed', 'Upload failed: connection timeout')),
    '❌ SrvKit: Backup "App DB" failed.\nUpload failed: connection timeout\n2026-06-25T03:12:44Z',
  )
  assert.equal(
    buildRecoveredMessage('App DB'),
    '✅ SrvKit: Backup "App DB" is back to OK.',
  )
})
