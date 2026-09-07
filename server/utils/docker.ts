import { request as httpRequest } from 'node:http'
import { existsSync } from 'node:fs'

// Minimal Docker Engine API client over the mounted unix socket. Used to list
// running containers and run a database dump inside one of them — no docker CLI needed.

export function dockerSocketPath(): string {
  return process.env.DOCKER_SOCKET || '/var/run/docker.sock'
}

export function dockerAvailable(): boolean {
  return existsSync(dockerSocketPath())
}

interface DockerResponse {
  status: number
  body: Buffer
}

function dockerRequest(
  method: string,
  path: string,
  body?: unknown,
): Promise<DockerResponse> {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : Buffer.from(JSON.stringify(body))
    const req = httpRequest(
      {
        socketPath: dockerSocketPath(),
        method,
        path,
        headers: {
          'content-type': 'application/json',
          ...(payload ? { 'content-length': payload.length } : {}),
        },
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (c: Buffer) => chunks.push(c))
        res.on('end', () =>
          resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks) }),
        )
      },
    )
    req.on('error', reject)
    if (payload) req.write(payload)
    req.end()
  })
}

async function dockerJson<T>(method: string, path: string, body?: unknown): Promise<T> {
  const { status, body: buf } = await dockerRequest(method, path, body)
  if (status < 200 || status >= 300) {
    let msg = `Docker API ${status}`
    try {
      msg = (JSON.parse(buf.toString('utf8')) as { message?: string }).message || msg
    } catch {
      /* non-JSON body */
    }
    throw new Error(msg)
  }
  return JSON.parse(buf.toString('utf8') || 'null') as T
}

export interface DockerContainer {
  id: string
  name: string
  image: string
}

interface RawContainer {
  Id: string
  Names: string[]
  Image: string
}

export async function listRunningContainers(): Promise<DockerContainer[]> {
  const raw = await dockerJson<RawContainer[]>('GET', '/containers/json')
  return raw.map((c) => ({
    id: c.Id,
    name: (c.Names?.[0] ?? c.Id).replace(/^\//, ''),
    image: c.Image,
  }))
}

export interface DockerContainerState extends DockerContainer {
  /** Raw Docker state: running | exited | restarting | paused | dead | created. */
  state: string
}

interface RawContainerState extends RawContainer {
  State: string
}

/** List ALL containers (running + stopped), with their raw state — for monitoring. */
export async function listAllContainers(): Promise<DockerContainerState[]> {
  const raw = await dockerJson<RawContainerState[]>('GET', '/containers/json?all=1')
  return raw.map((c) => ({
    id: c.Id,
    name: (c.Names?.[0] ?? c.Id).replace(/^\//, ''),
    image: c.Image,
    state: c.State,
  }))
}

/**
 * Inspect one container for its current state + last-exit timestamp. `FinishedAt`
 * drives the grace clock (so it survives SrvKit restarts), formatted as RFC3339
 * or "0001-01-01T00:00:00Z" when the container has never stopped.
 */
export async function inspectContainer(
  id: string,
): Promise<{ state: string; finishedAt: string | null }> {
  const j = await dockerJson<{ State?: { Status?: string; FinishedAt?: string } }>(
    'GET',
    `/containers/${encodeURIComponent(id)}/json`,
  )
  return { state: j.State?.Status ?? '', finishedAt: j.State?.FinishedAt ?? null }
}

/**
 * Demultiplex a Docker attach stream (Tty=false). Each frame is an 8-byte
 * header [streamType, 0,0,0, size(uint32 BE)] followed by `size` payload bytes.
 * streamType 2 = stderr, anything else (0/1) = stdout.
 */
export function parseDockerFrames(buf: Buffer): { stdout: Buffer; stderr: Buffer } {
  const out: Buffer[] = []
  const err: Buffer[] = []
  let i = 0
  while (i + 8 <= buf.length) {
    const type = buf[i]
    const size = buf.readUInt32BE(i + 4)
    const start = i + 8
    const end = start + size
    if (end > buf.length) break // truncated frame
    const payload = buf.subarray(start, end)
    if (type === 2) err.push(payload)
    else out.push(payload)
    i = end
  }
  return { stdout: Buffer.concat(out), stderr: Buffer.concat(err) }
}

export interface DumpOptions {
  container: string
  database: string
  user: string
  password: string
}

/**
 * Run `cmd` inside `container` with `env` and capture stdout, stderr and the
 * exit code. Throws only on a missing container or a socket error — a non-zero
 * exit is reported, not thrown, so callers can treat it as a signal (the binary
 * probe below does). `label` names the tool in error messages.
 */
async function execCapture(
  container: string,
  cmd: string[],
  env: string[],
  label: string,
): Promise<{ stdout: Buffer; stderr: Buffer; exitCode: number }> {
  const created = await dockerJson<{ Id: string }>(
    'POST',
    `/containers/${encodeURIComponent(container)}/exec`,
    { AttachStdout: true, AttachStderr: true, Cmd: cmd, Env: env },
  )
  const execId = created.Id

  // Start it and read the multiplexed output stream.
  const { status, body } = await dockerRequest('POST', `/exec/${execId}/start`, {
    Detach: false,
    Tty: false,
  })
  if (status < 200 || status >= 300) {
    throw new Error(`${label} exec failed (HTTP ${status})`)
  }
  const { stdout, stderr } = parseDockerFrames(body)

  const info = await dockerJson<{ ExitCode: number | null }>('GET', `/exec/${execId}/json`)
  return { stdout, stderr, exitCode: info.ExitCode ?? 0 }
}

/**
 * Run `cmd` inside `container` with `env`, returning stdout as a Buffer. Throws
 * on a missing container, a non-zero exit (with stderr), or a socket error.
 * `label` names the tool in error messages.
 */
async function execDump(
  container: string,
  cmd: string[],
  env: string[],
  label: string,
): Promise<Buffer> {
  const { stdout, stderr, exitCode } = await execCapture(container, cmd, env, label)
  if (exitCode !== 0) {
    const detail = stderr.toString('utf8').trim()
    throw new Error(`${label} exited ${exitCode}${detail ? `: ${detail}` : ''}`)
  }
  return stdout
}

/** Run `pg_dump` inside `container` and return the SQL dump (password via env). */
export function pgDump(opts: DumpOptions): Promise<Buffer> {
  return execDump(
    opts.container,
    ['pg_dump', '-U', opts.user, opts.database],
    [`PGPASSWORD=${opts.password}`],
    'pg_dump',
  )
}

/**
 * Dump binaries to look for inside a MySQL/MariaDB container, in order.
 * MariaDB >= 11 dropped the `mysqldump` compatibility symlink and ships only
 * `mariadb-dump`; MySQL and MariaDB <= 10.x have `mysqldump`. The invocation is
 * identical either way — only the binary name differs.
 */
const MYSQL_DUMP_BINARIES = ['mariadb-dump', 'mysqldump']

/**
 * Resolve the dump binary inside `container`, or null when none is present.
 * Called on every run rather than pinned at job creation, so a container image
 * upgrade or DB migration never needs the job to be reconfigured by hand.
 */
export async function resolveDumpBinary(
  container: string,
  candidates: string[] = MYSQL_DUMP_BINARIES,
): Promise<string | null> {
  const probe = candidates.map((b) => `command -v ${b}`).join(' || ')
  const { stdout, exitCode } = await execCapture(
    container,
    ['sh', '-c', probe],
    [],
    'dump binary lookup',
  )
  const path = stdout.toString('utf8').trim().split('\n')[0]?.trim() ?? ''
  return exitCode === 0 && path ? path : null
}

/**
 * Run the container's MySQL/MariaDB dump binary inside `container`. The password
 * goes via MYSQL_PWD (not `-p…`) so the command-line-password warning doesn't
 * pollute stdout — MariaDB's client tools read the same variable.
 */
export async function mysqlDump(opts: DumpOptions): Promise<Buffer> {
  const binary = await resolveDumpBinary(opts.container)
  if (!binary) {
    throw new Error(
      `No dump binary found in container ${opts.container} ` +
        `(looked for ${MYSQL_DUMP_BINARIES.join(', ')})`,
    )
  }
  return execDump(
    opts.container,
    [binary, '-u', opts.user, opts.database],
    [`MYSQL_PWD=${opts.password}`],
    binary.split('/').pop() || binary,
  )
}
