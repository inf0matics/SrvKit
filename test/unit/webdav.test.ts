import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseDirs, parseFiles } from '../../server/utils/backups.ts'

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

/* ---- parseFiles: the file half of a PROPFIND, used by retention (spec 19) ---- */

const dirXml = `<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:">
  <d:response>
    <d:href>/remote.php/dav/files/alice/srvkit/</d:href>
    <d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop></d:propstat>
  </d:response>
  <d:response>
    <d:href>/remote.php/dav/files/alice/srvkit/db_2026-09-10.tar.gz</d:href>
    <d:propstat><d:prop><d:resourcetype/></d:prop></d:propstat>
  </d:response>
  <d:response>
    <d:href>/remote.php/dav/files/alice/srvkit/db_2026-09-09.tar.gz</d:href>
    <d:propstat><d:prop><d:resourcetype/></d:prop></d:propstat>
  </d:response>
  <d:response>
    <d:href>/remote.php/dav/files/alice/srvkit/nested/</d:href>
    <d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop></d:propstat>
  </d:response>
</d:multistatus>`

test('parseFiles returns files only, skipping collections and self', () => {
  assert.deepEqual(parseFiles(dirXml, 'alice', 'srvkit').sort(), [
    'db_2026-09-09.tar.gz',
    'db_2026-09-10.tar.gz',
  ])
})

test('parseFiles decodes percent-encoded names and ignores deeper entries', () => {
  const xml = `<d:multistatus xmlns:d="DAV:">
    <d:response><d:href>/remote.php/dav/files/alice/srvkit/</d:href>
      <d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop></d:propstat></d:response>
    <d:response><d:href>/remote.php/dav/files/alice/srvkit/my%20backup.tar.gz</d:href>
      <d:propstat><d:prop><d:resourcetype/></d:prop></d:propstat></d:response>
    <d:response><d:href>/remote.php/dav/files/alice/srvkit/nested/deep.tar.gz</d:href>
      <d:propstat><d:prop><d:resourcetype/></d:prop></d:propstat></d:response>
  </d:multistatus>`
  assert.deepEqual(parseFiles(xml, 'alice', 'srvkit'), ['my backup.tar.gz'])
})

test('parseFiles returns nothing for a directory holding only folders', () => {
  assert.deepEqual(parseFiles(rootXml, 'alice', ''), ['readme.txt'])
})
