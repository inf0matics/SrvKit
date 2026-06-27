import { getServerName } from '../../utils/alerts.ts'
import { serverTimezone } from '../../../lib/cron.ts'

// General settings. Server name prefixes alert messages; timezone is the zone
// cron schedules run in (so the UI shows next-run times that match).
export default defineEventHandler(() => ({
  serverName: getServerName(),
  timezone: serverTimezone(),
}))
