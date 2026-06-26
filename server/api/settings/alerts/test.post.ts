import { getToken, getChatId, sendTestAlert } from '../../../utils/alerts.ts'

// Send a test Telegram message. Uses a token/chatId supplied in the body (so the
// user can test before saving), falling back to the stored channel.
export default defineEventHandler(async (event) => {
  const body = await readBody<Record<string, unknown>>(event)
  const token =
    typeof body?.token === 'string' && body.token.trim() ? body.token.trim() : getToken()
  const chatId =
    typeof body?.chatId === 'string' && body.chatId.trim()
      ? body.chatId.trim()
      : getChatId()

  try {
    await sendTestAlert(token, chatId)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
})
