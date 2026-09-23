import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import logger from '../utils/logger.js';

function getErrorCode(error: unknown): string | undefined {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    return typeof code === 'string' ? code : undefined;
  }

  return undefined;
}

export function resolveEntrypointPath(filePath: string | undefined): string | null {
  if (!filePath) return null;

  try {
    return fs.realpathSync(filePath);
  } catch (error) {
    const code = getErrorCode(error);
    if (code !== 'ENOENT') {
      logger.warn(`fs.realpathSync failed for "${filePath}", falling back to path.resolve.`, {
        code,
        error: error instanceof Error ? error.message : String(error)
      });
    }
    return path.resolve(filePath);
  }
}

// True when the module at `moduleUrl` is the process entry point.
// npm/npx commonly invoke package bins through symlinks; compare real paths so
// this still holds from those standard install paths (issues #65/#67/#79).
// PM2 fork-mode runs its ProcessContainerFork wrapper as argv[1] and loads the
// user script as a plain module, so argv[1] never matches — but a PM2-managed
// process is by definition running its configured entry script.
export function isMainModule(moduleUrl: string): boolean {
  if (process.env.pm_id !== undefined) return true;
  return resolveEntrypointPath(fileURLToPath(moduleUrl)) === resolveEntrypointPath(process.argv[1]);
}
