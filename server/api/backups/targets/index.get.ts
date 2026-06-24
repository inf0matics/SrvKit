import { store } from '../../../utils/srvkit.ts'

// List targets — summaries only, never the encrypted password.
export default defineEventHandler(() => store().listTargets())
