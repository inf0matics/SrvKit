import { getServerName, getRepeatHours } from '../../utils/alerts.ts'
import { serverTimezone } from '../../../lib/cron.ts'

// General settings. Server name prefixes alert messages; timezone is the zone
// cron schedules run in (so the UI shows next-run times that match);
// repeatHours is how often a still-failing job is re-announced (0 = off).
export default defineEventHandler(() => ({
  serverName: getServerName(),
  timezone: serverTimezone(),
  repeatHours: getRepeatHours(),
}))
