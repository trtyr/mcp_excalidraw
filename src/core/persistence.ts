// SQLite persistence for the canvas Maps (elements / snapshots / files).
//
// Design notes:
// - Uses the built-in `node:sqlite` (Node >= 22) so there is no new dependency.
// - Single-file store, one JSON blob per Map under a `kv` table — the canvas is
//   a single-user scene, so whole-scene writes (debounced) are simple and
//   reliably consistent compared to per-element row syncing.
// - The database is opened LAZILY on first write (or explicit hydrate), so
//   processes that merely import `types.ts` (MCP stdio server, CLI) never
//   touch the file and can never fight the canvas process for locks.
// - Canvas stays fully functional if persistence fails (logged, degraded to
//   in-memory behaviour), matching the upstream "in-memory by design" spirit.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import logger from '../utils/logger.js';

const FLUSH_DEBOUNCE_MS = 300;

export interface PersistenceHandle {
  /** Load the stored JSON for this key back into the given Map. */
  hydrate: (map: Map<string, unknown>) => void;
  /** Mark this key dirty and schedule a debounced flush. */
  markDirty: () => void;
}

interface RegisteredMap {
  key: string;
  map: Map<string, unknown>;
  dirty: boolean;
}

const registered: RegisteredMap[] = [];
let db: DatabaseSync | null = null;
let flushTimer: NodeJS.Timeout | null = null;

function dbPath(): string {
  const dir = process.env.EXCALIDRAW_DB_DIR || path.join(os.homedir(), '.excalidraw-canvas');
  return path.join(dir, 'canvas.db');
}

function openDb(): DatabaseSync | null {
  if (db) return db;
  try {
    const file = dbPath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    db = new DatabaseSync(file);
    db.exec('PRAGMA journal_mode = WAL;');
    db.exec('CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
    return db;
  } catch (error) {
    logger.error('Persistence: cannot open SQLite store, running in-memory only:', error);
    db = null;
    return null;
  }
}

function serialize(map: Map<string, unknown>): string {
  return JSON.stringify(Array.from(map.entries()));
}

function flushNow(): void {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  const dirty = registered.filter(r => r.dirty);
  if (dirty.length === 0) return;
  const store = openDb();
  if (!store) {
    dirty.forEach(r => (r.dirty = false));
    return;
  }
  try {
    store.exec('BEGIN');
    const upsert = store.prepare('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
    for (const r of dirty) {
      upsert.run(r.key, serialize(r.map));
      r.dirty = false;
    }
    store.exec('COMMIT');
  } catch (error) {
    try { store.exec('ROLLBACK'); } catch { /* already rolled back */ }
    logger.error('Persistence: flush failed (canvas keeps running in memory):', error);
    dirty.forEach(r => (r.dirty = false));
  }
}

function scheduleFlush(): void {
  if (flushTimer) return;
  flushTimer = setTimeout(flushNow, FLUSH_DEBOUNCE_MS);
  // Don't hold the process open just for a pending flush; the explicit
  // shutdown flush in server.ts covers exit-time durability.
  flushTimer.unref();
}

/**
 * Create a Map whose mutations are tracked and (debounced) persisted.
 * Drop-in replacement for `new Map()` in types.ts.
 */
export function createPersistentMap<K, V>(key: string): Map<K, V> {
  const store: RegisteredMap = { key, map: new Map<K, V>() as Map<string, unknown>, dirty: false };
  registered.push(store as unknown as RegisteredMap);

  const map = store.map as Map<K, V>;
  const originalSet = map.set.bind(map);
  const originalDelete = map.delete.bind(map);
  const originalClear = map.clear.bind(map);

  map.set = (...args: Parameters<typeof originalSet>) => {
    const result = originalSet(...(args as [K, V]));
    store.dirty = true;
    scheduleFlush();
    return result;
  };
  map.delete = (k: K) => {
    const result = originalDelete(k);
    if (result) {
      store.dirty = true;
      scheduleFlush();
    }
    return result;
  };
  map.clear = () => {
    originalClear();
    store.dirty = true;
    scheduleFlush();
  };
  return map;
}

/**
 * Load persisted state back into the registered Maps. Called once at canvas
 * server startup, before the HTTP listener accepts traffic.
 */
export function hydratePersistence(): void {
  const store = openDb();
  if (!store) return;
  try {
    const rows = store.prepare('SELECT key, value FROM kv').all() as { key: string; value: string }[];
    for (const row of rows) {
      const target = registered.find(r => r.key === row.key);
      if (!target) continue;
      try {
        const entries = JSON.parse(row.value) as [string, unknown][];
        target.map.clear();
        for (const [k, v] of entries) target.map.set(k, v);
        target.dirty = false;
        logger.info(`Persistence: restored ${entries.length} ${row.key}`);
      } catch (error) {
        logger.warn(`Persistence: corrupted JSON for key "${row.key}", starting empty:`, error);
      }
    }
  } catch (error) {
    logger.warn('Persistence: hydrate failed, starting empty:', error);
  }
}

/** Synchronous flush for process shutdown paths. */
export function flushPersistenceNow(): void {
  flushNow();
  try { db?.close(); } catch { /* already closed */ }
  db = null;
}
