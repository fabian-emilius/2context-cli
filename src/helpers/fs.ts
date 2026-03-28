import fs from 'node:fs/promises'
import nodePath from 'node:path'

/**
 * Scoped file-system helper. Every path is resolved relative to the
 * `workingPath` given at construction time (absolute paths pass through).
 */
export class FileSystem {
  readonly workingPath: string

  constructor(workingPath: string) {
    this.workingPath = workingPath
  }

  /**
   * Resolve a path against the working directory.
   * Absolute paths are returned as-is.
   */
  resolve(filePath: string): string {
    return nodePath.isAbsolute(filePath) ? filePath : nodePath.join(this.workingPath, filePath)
  }

  /**
   * Check whether a file or directory exists at the given path.
   */
  async pathExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(this.resolve(filePath))
      return true
    } catch {
      return false
    }
  }

  /**
   * Read a file as UTF-8 text, returning null if the file does not exist.
   */
  async readFileOrNull(filePath: string): Promise<string | null> {
    try {
      return await fs.readFile(this.resolve(filePath), 'utf-8')
    } catch {
      return null
    }
  }

  /**
   * Write content to a file, creating parent directories as needed.
   */
  async writeFileWithDir(filePath: string, content: string): Promise<void> {
    const resolved = this.resolve(filePath)
    const dir = nodePath.dirname(resolved)
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(resolved, content, 'utf-8')
  }

  /**
   * Recursively create a directory (and any missing parents).
   */
  async ensureDir(dirPath: string): Promise<void> {
    await fs.mkdir(this.resolve(dirPath), { recursive: true })
  }

  /**
   * Set restrictive file permissions (owner-only read/write).
   * On Windows this is a no-op — POSIX permissions are not supported.
   */
  async chmodOwnerOnly(filePath: string): Promise<void> {
    if (process.platform === 'win32') return

    try {
      await fs.chmod(this.resolve(filePath), 0o600)
    } catch {
      // Silently ignore permission errors (e.g. on some network mounts)
    }
  }

  /**
   * List directory entries, returning an empty array if the directory does not exist.
   */
  async readDirOrEmpty(dirPath: string): Promise<string[]> {
    try {
      return await fs.readdir(this.resolve(dirPath))
    } catch {
      return []
    }
  }

  /**
   * Get file modification time, returning null if the file does not exist.
   */
  async getFileModifiedDate(filePath: string): Promise<Date | null> {
    try {
      const stat = await fs.stat(this.resolve(filePath))
      return stat.mtime
    } catch {
      return null
    }
  }
}
