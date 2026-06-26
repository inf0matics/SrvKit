import { getServerName } from '../../utils/alerts.ts'

// General settings. Server name is used to prefix alert messages.
export default defineEventHandler(() => ({ serverName: getServerName() }))
