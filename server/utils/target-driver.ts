import {
  testWebdav,
  browseWebdav,
  uploadToWebdav,
  listWebdav,
  deleteWebdav,
  decryptPassword,
  type TestResult,
  type BrowseResult,
} from './backups.ts'
import {
  testLocalDir,
  browseLocalDir,
  uploadLocalFile,
  listLocalFiles,
  deleteLocalFile,
} from '../../lib/local-target.ts'
import type { TargetRecord } from '../../lib/store.ts'

/**
 * Every backup target is reached through one small interface, so a job and the
 * runner never need to know what kind of destination they are writing to.
 * `list()` and `delete()` exist for retention (spec 19) and are unused here.
 */
export interface TargetDriver {
  test(): Promise<TestResult>
  browse(path: string): Promise<BrowseResult>
  upload(destPath: string, bytes: Uint8Array): Promise<void>
  list(dirPath: string): Promise<string[]>
  delete(filePath: string): Promise<void>
}

/** A target's connection details, with the password in plaintext. */
export interface TargetSpec {
  type: string
  host: string
  username: string
  password: string
  rootDir: string
}

/**
 * Base directory holding the mounted backup destinations. Local targets write
 * only below this — a resolved path that escapes it is rejected, so an
 * authenticated user cannot make SrvKit write anywhere the container can reach.
 */
export function targetsDir(): string {
  return process.env.BACKUP_TARGETS_DIR || '/backup-targets'
}

function localDriver(spec: TargetSpec): TargetDriver {
  const base = targetsDir()
  return {
    async test() {
      return testLocalDir(base, spec.rootDir)
    },
    async browse(path: string) {
      return browseLocalDir(base, path)
    },
    async upload(destPath: string, bytes: Uint8Array) {
      uploadLocalFile(base, destPath, bytes)
    },
    async list(dirPath: string) {
      return listLocalFiles(base, dirPath)
    },
    async delete(filePath: string) {
      deleteLocalFile(base, filePath)
    },
  }
}

function webdavDriver(spec: TargetSpec): TargetDriver {
  const { host, username, password } = spec
  return {
    test: () => testWebdav(host, username, password),
    browse: (path: string) => browseWebdav(host, username, password, path),
    upload: (destPath: string, bytes: Uint8Array) =>
      uploadToWebdav(host, username, password, destPath, bytes),
    list: (dirPath: string) => listWebdav(host, username, password, dirPath),
    delete: (filePath: string) => deleteWebdav(host, username, password, filePath),
  }
}

/** Driver for a target spec whose password is already plaintext. */
export function driverFor(spec: TargetSpec): TargetDriver {
  return spec.type === 'local' ? localDriver(spec) : webdavDriver(spec)
}

/** Driver for a stored target, decrypting its password blob (WebDAV only). */
export function driverForTarget(target: TargetRecord): TargetDriver {
  return driverFor({
    type: target.type,
    host: target.host,
    username: target.username,
    // A local target stores no credentials — nothing to decrypt.
    password: target.type === 'local' ? '' : decryptPassword(target.password),
    rootDir: target.rootDir,
  })
}
