import { getAlertSettings } from '../../utils/alerts.ts'

// Current alert settings (Telegram channel + recovery toggle). Never returns
// the bot token — only whether one is configured.
export default defineEventHandler(() => ({ telegram: getAlertSettings() }))
