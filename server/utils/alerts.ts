import { randomUUID, randomBytes, createHmac } from 'node:crypto'
import { store } from './srvkit.ts'
import { encryptPassword, decryptPassword } from './backups.ts'
import type { RunResult } from '../../lib/store.ts'

// --- Config (stored in the `config` kv table; tokens encrypted at rest) ---
const K_TOKEN = 'alerts_tg_token'
const K_CHAT = 'alerts_tg_chat'
const K_ENABLED = 'alerts_tg_enabled'
const K_RECOVERY = 'alerts_recovery'
const K_REPEAT = 'alerts_repeat_hours'
// Nextcloud Talk channel
const K_NC_URL = 'alerts_nctalk_url'
const K_NC_SECRET = 'alerts_nctalk_secret'
const K_NC_CONV = 'alerts_nctalk_conv'
const K_NC_ENABLED = 'alerts_nctalk_enabled'

/** Bot token: decrypted from the DB, or the TELEGRAM_BOT_TOKEN env fallback. */
export function getToken(): string {
  const stored = store().getConfig(K_TOKEN)
  if (stored) {
    try {
      return decryptPassword(stored)
    } catch {
      return ''
    }
  }
  return process.env.TELEGRAM_BOT_TOKEN ?? ''
}

/** Chat id: from the DB, or the TELEGRAM_CHAT_ID env fallback. */
export function getChatId(): string {
  return store().getConfig(K_CHAT) ?? process.env.TELEGRAM_CHAT_ID ?? ''
}

function telegramEnabled(): boolean {
  return store().getConfig(K_ENABLED) === '1'
}

export function recoveryEnabled(): boolean {
  return store().getConfig(K_RECOVERY) !== '0' // default on
}

/**
 * Hours between reminders while a job stays failed; 0 = off (v1 behaviour: one
 * alert on the transition, then silence). Defaults to 24.
 */
export function getRepeatHours(): number {
  const raw = store().getConfig(K_REPEAT)
  if (raw === null) return 24
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? n : 0
}

export function setRepeatHours(hours: number): void {
  const n = Number.isFinite(hours) && hours > 0 ? Math.floor(hours) : 0
  store().setConfig(K_REPEAT, String(n))
}

/** Optional server name, used to prefix alert messages. */
export function getServerName(): string {
  return (store().getConfig('server_name') ?? process.env.SERVER_NAME ?? '').trim()
}

/** Message prefix: `[name|SrvKit]` when a server name is set, else `[SrvKit]`. */
export function messagePrefix(): string {
  const name = getServerName()
  return name ? `[${name}|SrvKit]` : '[SrvKit]'
}

export interface AlertSettings {
  chatId: string
  enabled: boolean
  /** Whether a bot token is configured (the token itself is never returned). */
  hasToken: boolean
  recovery: boolean
}

/** Settings shape for the UI — never includes the secret token. */
export function getAlertSettings(): AlertSettings {
  return {
    chatId: getChatId(),
    enabled: telegramEnabled(),
    hasToken: getToken().length > 0,
    recovery: recoveryEnabled(),
  }
}

/** Persist settings. Token is only written when a non-empty value is supplied. */
export function saveAlertSettings(input: Record<string, unknown>): void {
  if (typeof input.token === 'string' && input.token.trim()) {
    store().setConfig(K_TOKEN, encryptPassword(input.token.trim()))
  }
  if (typeof input.chatId === 'string') {
    store().setConfig(K_CHAT, input.chatId.trim())
  }
  if (typeof input.enabled === 'boolean') {
    store().setConfig(K_ENABLED, input.enabled ? '1' : '0')
  }
  if (typeof input.recovery === 'boolean') {
    store().setConfig(K_RECOVERY, input.recovery ? '1' : '0')
  }
}

// --- Nextcloud Talk channel ---
export function getTalkUrl(): string {
  return (store().getConfig(K_NC_URL) ?? '').trim()
}
export function getTalkConversation(): string {
  return (store().getConfig(K_NC_CONV) ?? '').trim()
}
export function getTalkSecret(): string {
  const stored = store().getConfig(K_NC_SECRET)
  if (!stored) return ''
  try {
    return decryptPassword(stored)
  } catch {
    return ''
  }
}
function talkEnabled(): boolean {
  return store().getConfig(K_NC_ENABLED) === '1'
}

export interface TalkSettings {
  url: string
  conversation: string
  enabled: boolean
  /** Whether a bot secret is configured (never returns the secret itself). */
  hasSecret: boolean
}

export function getTalkSettings(): TalkSettings {
  return {
    url: getTalkUrl(),
    conversation: getTalkConversation(),
    enabled: talkEnabled(),
    hasSecret: getTalkSecret().length > 0,
  }
}

/** Persist Talk settings. Bot secret only written when a non-empty value is given. */
export function saveTalkSettings(input: Record<string, unknown>): void {
  if (typeof input.url === 'string') {
    store().setConfig(K_NC_URL, input.url.trim().replace(/\/+$/, ''))
  }
  if (typeof input.conversation === 'string') {
    store().setConfig(K_NC_CONV, input.conversation.trim())
  }
  if (typeof input.secret === 'string' && input.secret.trim()) {
    store().setConfig(K_NC_SECRET, encryptPassword(input.secret.trim()))
  }
  if (typeof input.enabled === 'boolean') {
    store().setConfig(K_NC_ENABLED, input.enabled ? '1' : '0')
  }
}

// --- Delivery ---

/** Send a Telegram message; throws with a useful detail on failure. */
export async function sendTelegram(
  token: string,
  chatId: string,
  text: string,
): Promise<void> {
  // Plain text (no parse_mode): alert text contains arbitrary error output and
  // the [server|SrvKit] prefix, which would break Markdown/HTML entity parsing.
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text }),
  })
  if (!res.ok) {
    let detail = ''
    try {
      detail = ((await res.json()) as { description?: string }).description ?? ''
    } catch {
      /* non-JSON error body */
    }
    throw new Error(detail || `Telegram returned ${res.status}`)
  }
}

/** Send a test message using the given (or stored) channel. Throws on failure. */
export async function sendTestAlert(token: string, chatId: string): Promise<void> {
  if (!token || !chatId) {
    throw new Error('Bot token and chat ID are required to send a test message.')
  }
  // Use the same prefix real alerts do, so the test previews the server name.
  const text = `✅ ${messagePrefix()}: Test alert — Telegram is configured correctly.`
  await sendTelegram(token, chatId, text)
}

/**
 * Post a message to a Nextcloud Talk conversation via the Bot API (NC 27+).
 * Talk bots authenticate per-request with an HMAC-SHA256 signature over
 * `random + message` keyed by the shared bot secret — not a bearer token. A
 * random referenceId dedupes delivery on retry. Throws with detail on failure.
 */
export async function sendNextcloudTalk(
  url: string,
  secret: string,
  conversation: string,
  text: string,
): Promise<void> {
  const base = url.replace(/\/+$/, '')
  const endpoint = `${base}/ocs/v2.php/apps/spreed/api/v1/bot/${encodeURIComponent(conversation)}/message`
  const random = randomBytes(32).toString('hex') // ≥32 chars, per the API
  const signature = createHmac('sha256', secret).update(random + text).digest('hex')
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'X-Nextcloud-Talk-Bot-Random': random,
      'X-Nextcloud-Talk-Bot-Signature': signature,
      'OCS-APIRequest': 'true',
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify({ message: text, referenceId: randomUUID() }),
  })
  if (!res.ok) {
    throw new Error(`Nextcloud Talk returned ${res.status}`)
  }
}

/** Send a test message to the Talk conversation. Throws on failure. */
export async function sendTalkTest(
  url: string,
  secret: string,
  conversation: string,
): Promise<void> {
  if (!url || !secret || !conversation) {
    throw new Error('Nextcloud URL, bot secret and conversation token are all required.')
  }
  const text = `✅ ${messagePrefix()}: Test alert — Nextcloud Talk is configured correctly.`
  await sendNextcloudTalk(url, secret, conversation, text)
}

export function buildFailedMessage(prefix: string, name: string, run: RunResult): string {
  return `❌ ${prefix}: Backup "${name}" failed.\n${run.error ?? 'Unknown error'}\n${run.at}`
}

export function buildRecoveredMessage(prefix: string, name: string): string {
  return `✅ ${prefix}: Backup "${name}" is back to OK.`
}

const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'}`

/** Coarse elapsed time — the reminder needs "how long", not a precise duration. */
function elapsed(fromIso: string, toIso: string): string {
  const ms = Math.max(0, Date.parse(toIso) - Date.parse(fromIso))
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 60) return plural(Math.max(1, minutes), 'minute')
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return plural(hours, 'hour')
  return plural(Math.floor(hours / 24), 'day')
}

export interface ReminderContext {
  name: string
  /** First failure of the streak. */
  since: string
  /** Timestamp of the run that triggered this reminder. */
  now: string
  runs: number
  error: string | null
  lastSuccessAt: string | null
}

/**
 * The point of a reminder is the size of the gap: how long it has been failing,
 * how many runs that covers, and when a good backup last landed — none of which
 * the initial failure message can say.
 */
export function buildReminderMessage(prefix: string, ctx: ReminderContext): string {
  const scale = `${elapsed(ctx.since, ctx.now)}, ${plural(ctx.runs, 'run')}`
  return (
    `❌ ${prefix}: Backup "${ctx.name}" still failing — ${scale}.\n` +
    `${ctx.error ?? 'Unknown error'}\n` +
    `Last successful run: ${ctx.lastSuccessAt ?? 'never'}`
  )
}

async function dispatchTelegram(text: string): Promise<void> {
  const token = getToken()
  const chatId = getChatId()
  if (!telegramEnabled() || !token || !chatId) return // channel off / unconfigured
  try {
    await sendTelegram(token, chatId, text)
  } catch (e) {
    console.error('[alerts] Telegram delivery failed:', (e as Error).message)
  }
}

async function dispatchTalk(text: string): Promise<void> {
  const url = getTalkUrl()
  const secret = getTalkSecret()
  const conversation = getTalkConversation()
  if (!talkEnabled() || !url || !secret || !conversation) return
  try {
    await sendNextcloudTalk(url, secret, conversation, text)
  } catch (e) {
    console.error('[alerts] Nextcloud Talk delivery failed:', (e as Error).message)
  }
}

/**
 * Fan a message out to every enabled + configured channel. Channels are
 * independent — one failing (or unconfigured) never blocks the other. Never throws.
 */
export async function dispatch(text: string): Promise<void> {
  await Promise.all([dispatchTelegram(text), dispatchTalk(text)])
}

/**
 * Alert state machine, called after a job run is recorded. Emits on transitions
 * (OK→FAILED, FAILED→OK) and, while a job stays failed, one reminder per repeat
 * interval — a failure that goes quiet after day one is how a broken backup
 * survives for weeks. Never throws.
 */
export async function handleRunResult(jobId: string, run: RunResult): Promise<void> {
  try {
    const job = store().getJob(jobId)
    if (!job) return
    const prefix = messagePrefix()

    if (run.status === 'failed' && job.alertState !== 'failed') {
      // Open an incident: record the first failure of this streak.
      store().setJobAlertState(jobId, 'failed')
      store().setIncidentSince(jobId, run.at)
      store().setJobAlertSent(jobId, run.at)
      await dispatch(buildFailedMessage(prefix, job.name, run))
    } else if (run.status === 'failed' && job.alertState === 'failed') {
      // Still failing. Remind only once per interval, measured from the last
      // alert — a job failing every 15 minutes still sends at most one message.
      const hours = getRepeatHours()
      const since = job.incidentSince
      const last = job.lastAlertAt ?? since
      if (!hours || !since || !last) return
      if (Date.parse(run.at) - Date.parse(last) < hours * 3600_000) return
      store().setJobAlertSent(jobId, run.at)
      await dispatch(
        buildReminderMessage(prefix, {
          name: job.name,
          since,
          now: run.at,
          runs: job.failedRuns,
          error: run.error,
          lastSuccessAt: job.lastSuccessAt,
        }),
      )
    } else if (run.status === 'success' && job.alertState === 'failed') {
      // Close the incident and reset the reminder clock for the next streak.
      store().setJobAlertState(jobId, 'ok')
      store().setIncidentSince(jobId, null)
      store().setJobAlertSent(jobId, null)
      if (recoveryEnabled()) await dispatch(buildRecoveredMessage(prefix, job.name))
    }
  } catch (e) {
    console.error('[alerts] handleRunResult error:', (e as Error).message)
  }
}
