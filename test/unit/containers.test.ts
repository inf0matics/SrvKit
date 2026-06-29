import { test } from 'node:test'
import assert from 'node:assert/strict'
import { imageBaseName, matchesDbImage, dbTypeLabel } from '../../app/utils/containers.ts'

test('imageBaseName strips registry/path + tag/digest', () => {
  assert.equal(imageBaseName('docker.io/library/postgres:16'), 'postgres')
  assert.equal(imageBaseName('my-registry.com/postgres-custom:latest'), 'postgres-custom')
  assert.equal(imageBaseName('mysql:8'), 'mysql')
  assert.equal(imageBaseName('mariadb:11'), 'mariadb')
  assert.equal(imageBaseName('Postgres'), 'postgres') // lowercased
  assert.equal(imageBaseName('repo/img@sha256:abc'), 'img') // digest stripped
})

test('matchesDbImage filters by job type', () => {
  // PostgreSQL
  assert.equal(matchesDbImage('docker.io/library/postgres:16', 'postgres'), true)
  assert.equal(matchesDbImage('my-registry.com/postgres-custom:latest', 'postgres'), true)
  assert.equal(matchesDbImage('mysql:8', 'postgres'), false)
  // MySQL matches mysql + mariadb
  assert.equal(matchesDbImage('mysql:8', 'mysql'), true)
  assert.equal(matchesDbImage('mariadb:11', 'mysql'), true)
  assert.equal(matchesDbImage('postgres:16', 'mysql'), false)
  // Unknown type → unfiltered
  assert.equal(matchesDbImage('redis:7', 'files'), true)
})

test('dbTypeLabel', () => {
  assert.equal(dbTypeLabel('mysql'), 'MySQL')
  assert.equal(dbTypeLabel('postgres'), 'PostgreSQL')
})
