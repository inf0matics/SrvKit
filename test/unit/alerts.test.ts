import { test, before, beforeEach, after } from 'node:test'
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
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
  messagePrefix,
  sendTestAlert,
  getTalkSettings,
  saveTalkSettings,
  sendNextcloudTalk,
  buildReminderMessage,
  getRepeatHours,
  setRepeatHours,
} = await import('../../server/utils/alerts.ts')

let jobId = ''
const realFetch = globalThis.fetch
interface Call {
  url: string
  text: string
  parseMode: string | undefined
  body: Record<string, unknown>
  headers: Record<string, string>
}
let calls: Call[] = []

function mockOk() {
  globalThis.fetch = (async (
    url: string,
    init: { body: string; headers?: Record<string, string> },
  ) => {
    const body = JSON.parse(init.body) as Record<string, unknown>
    calls.push({
      url: String(url),
      text: (body.text ?? body.message) as string,
      parseMode: body.parse_mode as string | undefined,
      body,
      headers: init.headers ?? {},
    })
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
    keepVersions: 0,
    trigger: 'filewatcher',
    container: '',
    database: '',
    dbUser: '',
    dbPassword: '',
    schedule: '',
  }).id
})

beforeEach(() => {
  calls = []
  mockOk()
  // Reset to a known channel + state before each test (Talk off unless a test opts in).
  saveAlertSettings({ token: 'TKN', chatId: '123', enabled: true, recovery: true })
  saveTalkSettings({ enabled: false })
  store().setJobAlertState(jobId, 'ok')
  store().setIncidentSince(jobId, null)
  store().setJobAlertSent(jobId, null)
  setRepeatHours(24) // spec default
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
  // Sent as plain text — Markdown would choke on error output / the [..] prefix.
  assert.equal(calls[0]!.parseMode, undefined)
  assert.equal(store().getJob(jobId)?.alertState, 'failed')
  // The incident opens with the failing run's timestamp.
  assert.equal(store().getJob(jobId)?.incidentSince, '2026-06-25T03:12:44Z')
})

test('FAILED → OK closes the incident (clears incidentSince)', async () => {
  store().setJobAlertState(jobId, 'failed')
  store().setIncidentSince(jobId, '2026-06-25T01:00:00Z')
  await handleRunResult(jobId, run('success'))
  assert.equal(store().getJob(jobId)?.incidentSince, null)
})

test('failure text with Markdown-special characters is sent verbatim', async () => {
  const err =
    'pg_dump exited 1: role "x_y" does not exist [FATAL] *socket* `/var/run/postgresql`'
  await handleRunResult(jobId, run('failed', err))
  assert.equal(calls.length, 1)
  assert.equal(calls[0]!.parseMode, undefined)
  assert.ok(calls[0]!.text.includes(err)) // unescaped, intact
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
    buildFailedMessage('[SrvKit]', 'App DB', run('failed', 'Upload failed: connection timeout')),
    '❌ [SrvKit]: Backup "App DB" failed.\nUpload failed: connection timeout\n2026-06-25T03:12:44Z',
  )
  assert.equal(
    buildRecoveredMessage('[SrvKit]', 'App DB'),
    '✅ [SrvKit]: Backup "App DB" is back to OK.',
  )
})

test('test message carries the server-name prefix', async () => {
  store().setConfig('server_name', 'edge-1')
  await sendTestAlert('TKN', '123')
  assert.equal(calls.length, 1)
  assert.match(calls[0]!.text, /^✅ \[edge-1\|SrvKit\]: Test alert/)
  store().setConfig('server_name', '') // reset for other tests
})

test('message prefix uses the server name when set', () => {
  store().setConfig('server_name', '')
  assert.equal(messagePrefix(), '[SrvKit]')
  store().setConfig('server_name', 'prod-1')
  assert.equal(messagePrefix(), '[prod-1|SrvKit]')
  store().setConfig('server_name', '') // reset for other tests
})

test('Talk settings round-trip; bot secret is write-only and never returned', () => {
  saveTalkSettings({
    url: 'https://cloud.example.com/',
    conversation: 'room1',
    secret: 'NC-SECRET',
    enabled: true,
  })
  const s = getTalkSettings()
  assert.equal(s.url, 'https://cloud.example.com') // trailing slash stripped
  assert.equal(s.conversation, 'room1')
  assert.equal(s.enabled, true)
  assert.equal(s.hasSecret, true)
  assert.equal('secret' in s, false)
  saveTalkSettings({ enabled: false })
})

test('sendNextcloudTalk signs the request with HMAC-SHA256 over random + message', async () => {
  await sendNextcloudTalk('https://cloud.example.com/', 'NC-SECRET', 'room1', 'hello world')
  assert.equal(calls.length, 1)
  assert.match(calls[0]!.url, /\/ocs\/v2\.php\/apps\/spreed\/api\/v1\/bot\/room1\/message$/)
  assert.equal(calls[0]!.headers.authorization, undefined) // NOT bearer
  assert.equal(calls[0]!.headers['OCS-APIRequest'], 'true')
  const random = calls[0]!.headers['X-Nextcloud-Talk-Bot-Random']!
  assert.ok(random.length >= 32)
  const expected = createHmac('sha256', 'NC-SECRET').update(random + 'hello world').digest('hex')
  assert.equal(calls[0]!.headers['X-Nextcloud-Talk-Bot-Signature'], expected)
  assert.equal(calls[0]!.body.message, 'hello world')
  assert.match(String(calls[0]!.body.referenceId), /^[0-9a-f-]{36}$/) // random UUID dedupe
})

test('both channels fire independently when both are enabled', async () => {
  saveTalkSettings({
    url: 'https://cloud.example.com',
    conversation: 'room1',
    secret: 'NC-SECRET',
    enabled: true,
  })
  await handleRunResult(jobId, run('failed', 'boom'))
  assert.equal(calls.length, 2)
  const tg = calls.find((c) => c.url.includes('api.telegram.org'))!
  const talk = calls.find((c) => c.url.includes('/spreed/'))!
  assert.match(tg.text, /Backup "App DB" failed/)
  assert.match(talk.text, /Backup "App DB" failed/)
  saveTalkSettings({ enabled: false })
})

test('a disabled Talk channel is skipped — Telegram only', async () => {
  saveTalkSettings({
    url: 'https://cloud.example.com',
    conversation: 'room1',
    secret: 'NC-SECRET',
    enabled: false,
  })
  await handleRunResult(jobId, run('failed', 'boom'))
  assert.equal(calls.length, 1)
  assert.match(calls[0]!.url, /api\.telegram\.org/)
})

// --- Repeat alerts while a job stays failed (patch spec 09.01, delta 2) ---

/** Record a failed run `hoursAgo`-relative to a fixed clock, then alert on it. */
const T0 = Date.parse('2026-06-25T00:00:00Z')
const iso = (hours: number) => new Date(T0 + hours * 3600_000).toISOString()

async function failAt(hours: number, error = 'Dump produced 0 bytes', id = jobId) {
  const result = { at: iso(hours), status: 'failed' as const, error, bytes: 0 }
  store().recordRun(id, result)
  await handleRunResult(id, result)
}

async function succeedAt(hours: number, id = jobId) {
  const result = { at: iso(hours), status: 'success' as const, error: null, bytes: 42 }
  store().recordRun(id, result)
  await handleRunResult(id, result)
}

/** A job with no run history — `lastSuccessAt` is only ever null on a fresh one. */
function freshJob(name: string): string {
  return store().createJob({
    targetId: store().listJobs()[0]!.targetId,
    name,
    type: 'sqlite',
    sourcePath: 'app.db',
    includes: [],
    output: 'single',
    subdirectory: '',
    dateSuffix: false,
    timeSuffix: false,
    keepVersions: 0,
    trigger: 'filewatcher',
    container: '',
    database: '',
    dbUser: '',
    dbPassword: '',
    schedule: '',
  }).id
}

test('the repeat interval defaults to 24 h and round-trips through config', () => {
  assert.equal(getRepeatHours(), 24)
  setRepeatHours(6)
  assert.equal(getRepeatHours(), 6)
  setRepeatHours(0) // off
  assert.equal(getRepeatHours(), 0)
})

test('a job that stays failed reminds once per interval, not once per run', async () => {
  await failAt(0) // opens the incident → initial alert
  assert.equal(calls.length, 1)
  assert.match(calls[0]!.text, /failed/)

  // Four more runs inside the first 24 h window: silent.
  await failAt(1)
  await failAt(6)
  await failAt(12)
  await failAt(23)
  assert.equal(calls.length, 1)

  // Past the window: exactly one reminder.
  await failAt(25)
  assert.equal(calls.length, 2)
  assert.match(calls[1]!.text, /still failing/)

  // The clock restarts from the reminder, not from the first failure.
  await failAt(48)
  assert.equal(calls.length, 2)
  await failAt(50)
  assert.equal(calls.length, 3)
})

test('the reminder reports how long, how many runs, and the last success', async () => {
  await succeedAt(-24) // a good run a day before the streak
  calls = []
  await failAt(0)
  await failAt(24)

  const reminder = calls[calls.length - 1]!.text
  assert.match(reminder, /Backup "App DB" still failing — 1 day, 2 runs\./)
  assert.match(reminder, /Dump produced 0 bytes/)
  assert.match(reminder, /Last successful run: 2026-06-24T00:00:00\.000Z/)
})

test('a job that has never succeeded says so instead of naming a timestamp', async () => {
  const virgin = freshJob('Never Worked')
  await failAt(0, 'boom', virgin)
  await failAt(25, 'boom', virgin)
  assert.match(calls[calls.length - 1]!.text, /Last successful run: never/)
})

test('repeat interval off restores v1 behaviour: one alert, then silence', async () => {
  setRepeatHours(0)
  await failAt(0)
  assert.equal(calls.length, 1)
  await failAt(48)
  await failAt(96)
  assert.equal(calls.length, 1)
})

test('recovery after reminders sends one recovery and resets the timer', async () => {
  await failAt(0)
  await failAt(25) // reminder
  assert.equal(calls.length, 2)

  await succeedAt(26)
  assert.equal(calls.length, 3)
  assert.match(calls[2]!.text, /back to OK/)
  assert.equal(store().getJob(jobId)?.lastAlertAt, null)

  // A fresh streak alerts immediately rather than waiting out the old window.
  await failAt(27)
  assert.equal(calls.length, 4)
  assert.match(calls[3]!.text, /failed/)
})

test('a disabled channel suppresses reminders too', async () => {
  await failAt(0)
  saveAlertSettings({ enabled: false })
  await failAt(25)
  assert.equal(calls.length, 1) // only the initial alert, sent while enabled
})

test('buildReminderMessage pluralises days and runs', () => {
  const text = buildReminderMessage('[SrvKit]', {
    name: 'Shlink DB',
    since: '2026-08-12T03:12:44Z',
    now: '2026-09-07T03:12:44Z',
    runs: 26,
    error: 'Dump produced 0 bytes — nothing was backed up',
    lastSuccessAt: '2026-08-12T03:12:44Z',
  })
  assert.match(text, /Backup "Shlink DB" still failing — 26 days, 26 runs\./)
  assert.match(text, /Last successful run: 2026-08-12T03:12:44Z/)
})
