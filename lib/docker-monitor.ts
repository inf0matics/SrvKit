// Pure container-status logic (no socket / no store) so it's unit-testable.
// Mirrors checkmk's docker_container_status with an added grace period.

export type ContainerStatus = 'ok' | 'warn' | 'crit' | 'pending'

export interface StatusResult {
  status: ContainerStatus
  /** While pending, the level that will fire once the grace period elapses. */
  pendingLevel: 'warn' | 'crit' | null
}

/**
 * Map a raw Docker state + how long it's been off `running` to a SrvKit status.
 *
 * | state                         | result                  |
 * |-------------------------------|-------------------------|
 * | running                       | OK                      |
 * | dead                          | CRIT (no grace)         |
 * | paused                        | WARN                    |
 * | restarting, within grace      | pending → WARN          |
 * | restarting, grace exceeded    | WARN (crash-loop)       |
 * | not running, within grace     | pending → CRIT          |
 * | not running, grace exceeded   | CRIT                    |
 */
export function containerStatus(
  state: string,
  elapsedSec: number,
  graceSec: number,
): StatusResult {
  if (state === 'running') return { status: 'ok', pendingLevel: null }
  if (state === 'dead') return { status: 'crit', pendingLevel: null }
  if (state === 'paused') return { status: 'warn', pendingLevel: null }
  if (state === 'restarting') {
    return elapsedSec > graceSec
      ? { status: 'warn', pendingLevel: null }
      : { status: 'pending', pendingLevel: 'warn' }
  }
  // exited / created / removing / any other non-running state
  return elapsedSec > graceSec
    ? { status: 'crit', pendingLevel: null }
    : { status: 'pending', pendingLevel: 'crit' }
}

/** Worst of a set of statuses for the sidebar badge (pending/off don't count). */
export function worstContainerStatus(statuses: ContainerStatus[]): ContainerStatus {
  if (statuses.includes('crit')) return 'crit'
  if (statuses.includes('warn')) return 'warn'
  return 'ok'
}
