import fs from 'node:fs/promises'
import path from 'node:path'

/**
 * Check whether a file or directory exists at the given path.
 */
export async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

/**
 * Read a file as UTF-8 text, returning null if the file does not exist.
 */
export async function readFileOrNull(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, 'utf-8')
  } catch {
    return null
  }
}

/**
 * Write content to a file, creating parent directories as needed.
 */
export async function writeFileWithDir(filePath: string, content: string): Promise<void> {
  const dir = path.dirname(filePath)
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(filePath, content, 'utf-8')
}

/**
 * Recursively create a directory (and any missing parents).
 */
export async function ensureDir(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true })
}

/**
 * Set restrictive file permissions (owner-only read/write).
 * On Windows this is a no-op — POSIX permissions are not supported.
 */
export async function chmodOwnerOnly(filePath: string): Promise<void> {
  if (process.platform === 'win32') return

  try {
    await fs.chmod(filePath, 0o600)
  } catch {
    // Silently ignore permission errors (e.g. on some network mounts)
  }
}

/**
 * List directory entries, returning an empty array if the directory does not exist.
 */
export async function readDirOrEmpty(dirPath: string): Promise<string[]> {
  try {
    return await fs.readdir(dirPath)
  } catch {
    return []
  }
}

/**
 * Get file modification time, returning null if the file does not exist.
 */
export async function getFileModifiedDate(filePath: string): Promise<Date | null> {
  try {
    const stat = await fs.stat(filePath)
    return stat.mtime
  } catch {
    return null
  }
}
