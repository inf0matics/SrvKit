import { store } from './srvkit.ts'
import { encryptPassword, decryptPassword } from './backups.ts'
import type { RunResult } from '../../lib/store.ts'

// --- Config (stored in the `config` kv table; token encrypted at rest) ---
const K_TOKEN = 'alerts_tg_token'
const K_CHAT = 'alerts_tg_chat'
const K_ENABLED = 'alerts_tg_enabled'
const K_RECOVERY = 'alerts_recovery'

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

function recoveryEnabled(): boolean {
  return store().getConfig(K_RECOVERY) !== '0' // default on
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

// --- Delivery ---

/** Send a Telegram message; throws with a useful detail on failure. */
export async function sendTelegram(
  token: string,
  chatId: string,
  text: string,
): Promise<void> {
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' }),
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
  await sendTelegram(token, chatId, '✅ SrvKit test alert — Telegram is configured correctly.')
}

export function buildFailedMessage(name: string, run: RunResult): string {
  return `❌ SrvKit: Backup "${name}" failed.\n${run.error ?? 'Unknown error'}\n${run.at}`
}

export function buildRecoveredMessage(name: string): string {
  return `✅ SrvKit: Backup "${name}" is back to OK.`
}

async function dispatch(text: string): Promise<void> {
  const token = getToken()
  const chatId = getChatId()
  if (!telegramEnabled() || !token || !chatId) return // channel off / unconfigured
  try {
    await sendTelegram(token, chatId, text)
  } catch (e) {
    // Failed delivery is logged; no retry in v1.
    console.error('[alerts] Telegram delivery failed:', (e as Error).message)
  }
}

/**
 * Alert state machine, called after a job run is recorded. Emits on transitions
 * only (OK→FAILED and FAILED→OK) so a job that stays failed doesn't spam.
 * Muted jobs still advance their state but emit nothing. Never throws.
 */
export async function handleRunResult(jobId: string, run: RunResult): Promise<void> {
  try {
    const job = store().getJob(jobId)
    if (!job) return

    if (run.status === 'failed' && job.alertState !== 'failed') {
      store().setJobAlertState(jobId, 'failed')
      if (!job.muted) await dispatch(buildFailedMessage(job.name, run))
    } else if (run.status === 'success' && job.alertState === 'failed') {
      store().setJobAlertState(jobId, 'ok')
      if (!job.muted && recoveryEnabled()) {
        await dispatch(buildRecoveredMessage(job.name))
      }
    }
  } catch (e) {
    console.error('[alerts] handleRunResult error:', (e as Error).message)
  }
}
