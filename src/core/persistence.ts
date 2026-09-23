// Persistence for the canvas Maps (elements / snapshots / files).
//
// Two backends, chosen at startup:
// - SQLite (node:sqlite, Node >= 22.5) when available — preferred.
// - JSON file fallback (~/.excalidraw-canvas/canvas.json) for older runtimes.
// Both store the whole scene as one blob (single-user canvas), debounced.
// The store opens LAZILY so processes that merely import types.ts (MCP stdio,
// CLI) never touch the disk. Canvas stays functional if persistence fails.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import logger from '../utils/logger.js';

const FLUSH_DEBOUNCE_MS = 300;

interface RegisteredMap { key: string; map: Map<string, unknown>; dirty: boolean }
const registered: RegisteredMap[] = [];

let db: import('node:sqlite').DatabaseSync | null = null;
let sqliteOK = false;
let probed = false;
let flushTimer: NodeJS.Timeout | null = null;

function dataDir(): string {
  return process.env.EXCALIDRAW_DB_DIR || path.join(os.homedir(), '.excalidraw-canvas');
}
function jsonPath(): string { return path.join(dataDir(), 'canvas.json'); }
function dbFile(): string { return path.join(dataDir(), 'canvas.db'); }

async function probe(): Promise<void> {
  if (probed) return;
  probed = true;
  try {
    const mod = await import('node:sqlite');
    const DatabaseSync = mod.DatabaseSync;
    fs.mkdirSync(dataDir(), { recursive: true });
    db = new DatabaseSync(dbFile());
    db.exec('PRAGMA journal_mode = WAL;');
    db.exec('CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
    sqliteOK = true;
    logger.info('Persistence: backend = sqlite');
  } catch {
    sqliteOK = false;
    try { fs.mkdirSync(dataDir(), { recursive: true }); } catch { /* in-memory only */ }
    logger.info('Persistence: node:sqlite unavailable, backend = json file');
  }
}

function flushSqlite(dirty: RegisteredMap[]): void {
  const store = db!;
  try {
    store.exec('BEGIN');
    const upsert = store.prepare('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
    for (const r of dirty) { upsert.run(r.key, JSON.stringify(Array.from(r.map.entries()))); r.dirty = false; }
    store.exec('COMMIT');
  } catch (error) {
    try { store.exec('ROLLBACK'); } catch { /* noop */ }
    logger.error('Persistence: sqlite flush failed:', error);
    dirty.forEach(r => (r.dirty = false));
  }
}

function readJsonBlob(): Record<string, unknown> {
  return fs.existsSync(jsonPath()) ? JSON.parse(fs.readFileSync(jsonPath(), 'utf8')) : {};
}

function flushJson(dirty: RegisteredMap[]): void {
  try {
    const data = readJsonBlob();
    for (const r of dirty) { data[r.key] = Array.from(r.map.entries()); r.dirty = false; }
    const tmp = jsonPath() + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data));
    fs.renameSync(tmp, jsonPath());
  } catch (error) {
    logger.error('Persistence: json flush failed:', error);
    dirty.forEach(r => (r.dirty = false));
  }
}

function flushNow(): void {
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
  const dirty = registered.filter(r => r.dirty);
  if (dirty.length === 0 || !probed) return;
  if (sqliteOK) flushSqlite(dirty); else flushJson(dirty);
}

function scheduleFlush(): void {
  if (flushTimer) return;
  flushTimer = setTimeout(flushNow, FLUSH_DEBOUNCE_MS);
  flushTimer.unref();
}

export function createPersistentMap<K, V>(key: string): Map<K, V> {
  const store: RegisteredMap = { key, map: new Map<K, V>() as Map<string, unknown>, dirty: false };
  registered.push(store as unknown as RegisteredMap);
  const map = store.map as Map<K, V>;
  const origSet = map.set.bind(map), origDelete = map.delete.bind(map), origClear = map.clear.bind(map);
  map.set = (...a: Parameters<typeof origSet>) => { const r = origSet(...(a as [K, V])); store.dirty = true; scheduleFlush(); return r; };
  map.delete = (k: K) => { const r = origDelete(k); if (r) { store.dirty = true; scheduleFlush(); } return r; };
  map.clear = () => { origClear(); store.dirty = true; scheduleFlush(); };
  return map;
}

export async function hydratePersistence(): Promise<void> {
  await probe();
  try {
    const entriesFor = (key: string): [string, unknown][] | null => {
      if (sqliteOK && db) {
        const row = db.prepare('SELECT value FROM kv WHERE key = ?').get(key) as { value: string } | undefined;
        return row ? JSON.parse(row.value) : null;
      }
      if (fs.existsSync(jsonPath())) {
        const data = readJsonBlob();
        return (data[key] as [string, unknown][]) ?? null;
      }
      return null;
    };
    for (const r of registered) {
      const entries = entriesFor(r.key);
      if (!entries) continue;
      try {
        r.map.clear();
        for (const [k, v] of entries) r.map.set(k, v);
        r.dirty = false;
        logger.info(`Persistence: restored ${entries.length} ${r.key}`);
      } catch (error) { logger.warn(`Persistence: corrupt "${r.key}", starting empty:`, error); }
    }
  } catch (error) { logger.warn('Persistence: hydrate failed, starting empty:', error); }
}

export function flushPersistenceNow(): void {
  flushNow();
  try { db?.close(); } catch { /* noop */ }
  db = null;
}
