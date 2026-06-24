import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseDirs } from '../../server/utils/backups.ts'

const rootXml = `<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:">
  <d:response>
    <d:href>/remote.php/dav/files/alice/</d:href>
    <d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop></d:propstat>
  </d:response>
  <d:response>
    <d:href>/remote.php/dav/files/alice/srvkit/</d:href>
    <d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop></d:propstat>
  </d:response>
  <d:response>
    <d:href>/remote.php/dav/files/alice/photos/</d:href>
    <d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop></d:propstat>
  </d:response>
  <d:response>
    <d:href>/remote.php/dav/files/alice/readme.txt</d:href>
    <d:propstat><d:prop><d:resourcetype/></d:prop></d:propstat>
  </d:response>
</d:multistatus>`

test('lists immediate child directories, skipping files and self', () => {
  assert.deepEqual(parseDirs(rootXml, 'alice', ''), ['photos', 'srvkit'])
})

test('handles a nested path and encoded names', () => {
  const xml = `<d:multistatus xmlns:d="DAV:">
    <d:response><d:href>/remote.php/dav/files/alice/srvkit/</d:href>
      <d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop></d:propstat></d:response>
    <d:response><d:href>/remote.php/dav/files/alice/srvkit/my%20backups/</d:href>
      <d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop></d:propstat></d:response>
  </d:multistatus>`
  assert.deepEqual(parseDirs(xml, 'alice', 'srvkit'), ['my backups'])
})

test('is namespace-agnostic (uppercase D:)', () => {
  const xml = `<D:multistatus xmlns:D="DAV:">
    <D:response><D:href>/remote.php/dav/files/alice/</D:href>
      <D:propstat><D:prop><D:resourcetype><D:collection/></D:resourcetype></D:prop></D:propstat></D:response>
    <D:response><D:href>/remote.php/dav/files/alice/data/</D:href>
      <D:propstat><D:prop><D:resourcetype><D:collection/></D:resourcetype></D:prop></D:propstat></D:response>
  </D:multistatus>`
  assert.deepEqual(parseDirs(xml, 'alice', ''), ['data'])
})

test('returns nothing for an empty multistatus', () => {
  assert.deepEqual(parseDirs('<d:multistatus xmlns:d="DAV:"></d:multistatus>', 'alice', ''), [])
})
