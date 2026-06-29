import {
  getToken,
  getChatId,
  sendTestAlert,
  getTalkUrl,
  getTalkBotToken,
  getTalkConversation,
  sendTalkTest,
} from '../../../utils/alerts.ts'

// Send a test message on the requested channel (default telegram). Values may be
// supplied in the body so the user can test before saving, else the stored ones.
export default defineEventHandler(async (event) => {
  const body = await readBody<Record<string, unknown>>(event)
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : '')

  try {
    if (body?.channel === 'talk') {
      const talk = (body.talk ?? {}) as Record<string, unknown>
      await sendTalkTest(
        str(talk.url) || getTalkUrl(),
        str(talk.botToken) || getTalkBotToken(),
        str(talk.conversation) || getTalkConversation(),
      )
    } else {
      await sendTestAlert(str(body?.token) || getToken(), str(body?.chatId) || getChatId())
    }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
})
