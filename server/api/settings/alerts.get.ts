import { getAlertSettings, getTalkSettings } from '../../utils/alerts.ts'

// Current alert settings (Telegram + Nextcloud Talk). Never returns a bot token
// — only whether one is configured.
export default defineEventHandler(() => ({
  telegram: getAlertSettings(),
  talk: getTalkSettings(),
}))
