import { test } from 'node:test'
import assert from 'node:assert/strict'
import { containerStatus, worstContainerStatus } from '../../lib/docker-monitor.ts'

test('running is OK', () => {
  assert.deepEqual(containerStatus('running', 999, 30), { status: 'ok', pendingLevel: null })
})

test('dead is CRIT immediately (no grace)', () => {
  assert.deepEqual(containerStatus('dead', 0, 30), { status: 'crit', pendingLevel: null })
})

test('paused is WARN', () => {
  assert.deepEqual(containerStatus('paused', 0, 30), { status: 'warn', pendingLevel: null })
})

test('exited within grace is pending → CRIT', () => {
  assert.deepEqual(containerStatus('exited', 10, 30), { status: 'pending', pendingLevel: 'crit' })
})

test('exited beyond grace is CRIT', () => {
  assert.deepEqual(containerStatus('exited', 31, 30), { status: 'crit', pendingLevel: null })
})

test('restarting within grace is pending → WARN (normal restart)', () => {
  assert.deepEqual(containerStatus('restarting', 5, 30), { status: 'pending', pendingLevel: 'warn' })
})

test('restarting beyond grace is WARN (crash-loop)', () => {
  assert.deepEqual(containerStatus('restarting', 31, 30), { status: 'warn', pendingLevel: null })
})

test('grace boundary is inclusive (elapsed == grace stays pending)', () => {
  assert.equal(containerStatus('exited', 30, 30).status, 'pending')
})

test('worstContainerStatus picks the most severe', () => {
  assert.equal(worstContainerStatus(['ok', 'warn', 'ok']), 'warn')
  assert.equal(worstContainerStatus(['ok', 'warn', 'crit']), 'crit')
  assert.equal(worstContainerStatus(['ok', 'ok']), 'ok')
  assert.equal(worstContainerStatus([]), 'ok')
})
