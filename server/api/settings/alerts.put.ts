import {
  getAlertSettings,
  saveAlertSettings,
  getTalkSettings,
  saveTalkSettings,
} from '../../utils/alerts.ts'

// Save alert settings. Telegram fields are read flat (back-compat); Nextcloud
// Talk fields under `talk`. Bot tokens are write-only (only applied when
// non-empty), so each card can save independently without clobbering the other.
export default defineEventHandler(async (event) => {
  const body = await readBody<Record<string, unknown>>(event)
  saveAlertSettings(body ?? {})
  if (body?.talk && typeof body.talk === 'object') {
    saveTalkSettings(body.talk as Record<string, unknown>)
  }
  return { telegram: getAlertSettings(), talk: getTalkSettings() }
})
