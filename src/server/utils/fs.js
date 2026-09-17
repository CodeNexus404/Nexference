import { renameSync, copyFileSync, unlinkSync } from 'fs';

// Windows-safe atomic rename.
//
// On POSIX, rename(2) over an existing target is atomic and never fails while
// the destination is merely open. On Windows, renameSync maps to MoveFileExW,
// which throws EBUSY/EPERM/EACCES when another process holds the destination
// open (e.g. Claude Code or an editor has settings.json). We retry briefly and,
// as a last resort, copy-over + unlink so the write still lands after the backup
// step has already succeeded (the caller's verified re-read confirms the result).
//
// POSIX behaviour is intentionally untouched.
export function atomicRenameSync(src, dest, { attempts = 8, delayMs = 30 } = {}) {
  if (process.platform !== 'win32') {
    renameSync(src, dest);
    return;
  }
  for (let i = 0; i < attempts; i++) {
    try {
      renameSync(src, dest);
      return;
    } catch (err) {
      const code = err && err.code;
      if (!/EBUSY|EPERM|EACCES|EEXIST|ENOTEMPTY/i.test(code || '')) throw err;
      if (i === attempts - 1) {
        copyFileSync(src, dest);
        unlinkSync(src);
        return;
      }
      const end = Date.now() + delayMs;
      while (Date.now() < end) { /* busy wait */ }
    }
  }
}