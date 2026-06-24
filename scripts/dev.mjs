/**
 * Finds a free port and starts the dev server on it.
 * Prevents port conflicts when multiple tsp.tools services run in parallel.
 *
 * Usage (package.json): "dev": "node scripts/dev.mjs nuxt dev"
 */
import { createServer } from 'net'
import { spawn } from 'child_process'

const port = await new Promise(resolve => {
  const s = createServer()
  s.listen(0, '127.0.0.1', () => {
    const p = s.address().port
    s.close(() => resolve(p))
  })
})

console.log(`▸ dev server → http://localhost:${port}`)

const [cmd, ...args] = process.argv.slice(2)
spawn(cmd, [...args, '--port', String(port)], { stdio: 'inherit' })
  .on('exit', code => process.exit(code ?? 0))
