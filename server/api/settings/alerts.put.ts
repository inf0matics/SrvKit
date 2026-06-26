import { getAlertSettings, saveAlertSettings } from '../../utils/alerts.ts'

// Save alert settings. The bot token is only updated when a non-empty value is
// sent (write-only), so the UI can omit it once configured.
export default defineEventHandler(async (event) => {
  const body = await readBody<Record<string, unknown>>(event)
  saveAlertSettings(body ?? {})
  return { telegram: getAlertSettings() }
})
