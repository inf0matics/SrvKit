import { request as httpRequest } from 'node:http'
import { existsSync } from 'node:fs'

// Minimal Docker Engine API client over the mounted unix socket. Used to list
// running containers and run pg_dump inside one of them — no docker CLI needed.

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

  // Check the exit code.
  const info = await dockerJson<{ ExitCode: number | null }>('GET', `/exec/${execId}/json`)
  if (info.ExitCode && info.ExitCode !== 0) {
    const detail = stderr.toString('utf8').trim()
    throw new Error(`${label} exited ${info.ExitCode}${detail ? `: ${detail}` : ''}`)
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
 * Run `mysqldump` inside `container`. The password goes via MYSQL_PWD (not
 * `-p…`) so mysqldump's command-line-password warning doesn't pollute stdout.
 */
export function mysqlDump(opts: DumpOptions): Promise<Buffer> {
  return execDump(
    opts.container,
    ['mysqldump', '-u', opts.user, opts.database],
    [`MYSQL_PWD=${opts.password}`],
    'mysqldump',
  )
}
