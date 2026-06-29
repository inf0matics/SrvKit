import { store } from '../utils/srvkit.ts'
import { getServerName } from '../utils/alerts.ts'
import { readMetrics } from '../utils/host.ts'
import { readContainers } from '../utils/docker-monitor.ts'
import { listPeerViews, outgoingView } from '../utils/peers.ts'

// Dashboard summary: backups (jobs/last/incidents) plus a live cross-subsystem
// snapshot — server name, monitored Docker services, active alarms (host/docker/
// peer), and incoming + outgoing heartbeat peers.
export default defineEventHandler(async () => {
  const jobs = store().listJobs()

  let lastBackup: { name: string; at: string } | null = null
  for (const j of jobs) {
    if (j.lastStatus === 'success' && j.lastRunAt) {
      if (!lastBackup || j.lastRunAt > lastBackup.at) lastBackup = { name: j.name, at: j.lastRunAt }
    }
  }

  const host = readMetrics()
  const docker = await readContainers()
  const { peers } = listPeerViews()

  // Active alarms = everything currently firing across the monitors (backup
  // failures stay in their own "Open incidents" box so they remain clickable).
  const alarms: { source: 'host' | 'docker' | 'peer'; name: string; detail: string; level: 'warn' | 'crit' }[] = []
  for (const m of host.metrics) {
    if (m.status === 'warn' || m.status === 'crit') {
      alarms.push({ source: 'host', name: m.name, detail: m.display, level: m.status })
    }
  }
  for (const c of docker.containers) {
    if (c.enabled && (c.status === 'warn' || c.status === 'crit')) {
      alarms.push({ source: 'docker', name: c.name, detail: c.state, level: c.status })
    }
  }
  for (const p of peers) {
    if (p.status === 'crit') {
      alarms.push({ source: 'peer', name: p.name, detail: 'no heartbeat', level: 'crit' })
    }
  }

  return {
    serverName: getServerName(),
    jobCount: jobs.length,
    lastBackup,
    incidents: store().listIncidents(),
    alarms,
    docker: {
      available: docker.available,
      services: docker.containers
        .filter((c) => c.enabled)
        .map((c) => ({ name: c.name, state: c.state, status: c.status })),
    },
    peers: peers.map((p) => ({ name: p.name, status: p.status, lastSeenAgoMs: p.lastSeenAgoMs })),
    outgoing: outgoingView(),
  }
})
