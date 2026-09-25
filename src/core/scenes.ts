// Scene registry — multi-canvas support.
// Each scene owns three persistent maps (elements/snapshots/files) keyed
// scene:<name>:* in the kv store; metadata lives in the scene-index map.
// Created lazily; maps created after hydratePersistence() self-hydrate via
// readPersistedEntries (the startup loop only covers import-time maps).
import { createPersistentMap, readPersistedEntries, deletePersistedKey } from './persistence.js';
import type { ServerElement, Snapshot, ExcalidrawFile } from '../types.js';

export interface SceneMeta {
  name: string;
  createdAt: string;
  lastUsedAt: string;
  deletedAt: string | null; // soft-delete (recycle bin) timestamp
}

export interface SceneMaps {
  elements: Map<string, ServerElement>;
  snapshots: Map<string, Snapshot>;
  files: Map<string, ExcalidrawFile>;
}

export const DEFAULT_SCENE = 'default';
export const SCENE_NAME_RE = /^[a-zA-Z0-9_-]{1,64}$/;

const sceneIndex = createPersistentMap<string, SceneMeta>('scene-index');
const cache = new Map<string, SceneMaps>();
const touchAt = new Map<string, number>(); // last in-memory lastUsedAt write

export function isValidSceneName(name: string): boolean {
  return SCENE_NAME_RE.test(name);
}

function ensureMeta(name: string): SceneMeta {
  let meta = sceneIndex.get(name);
  if (!meta) {
    meta = { name, createdAt: new Date().toISOString(), lastUsedAt: new Date().toISOString(), deletedAt: null };
    sceneIndex.set(name, meta);
  }
  return meta;
}

function hydrateInto<K, V>(map: Map<K, V>, key: string): void {
  const entries = readPersistedEntries(key);
  if (!entries) return;
  for (const [k, v] of entries as [string, unknown][]) map.set(k as K, v as V);
}

function mapsFor(name: string): SceneMaps {
  let m = cache.get(name);
  if (!m) {
    m = {
      elements: createPersistentMap<string, ServerElement>(`scene:${name}:elements`),
      snapshots: createPersistentMap<string, Snapshot>(`scene:${name}:snapshots`),
      files: createPersistentMap<string, ExcalidrawFile>(`scene:${name}:files`),
    };
    hydrateInto(m.elements, `scene:${name}:elements`);
    hydrateInto(m.snapshots, `scene:${name}:snapshots`);
    hydrateInto(m.files, `scene:${name}:files`);
    cache.set(name, m);
  }
  return m;
}

const TOUCH_THROTTLE_MS = 60_000;

/** Resolve maps for a scene (auto-vivifies metadata; revives soft-deleted scenes on use). */
export function getSceneMaps(name: string = DEFAULT_SCENE): SceneMaps {
  if (!isValidSceneName(name)) throw new Error(`Invalid scene name "${name}" (expected ${SCENE_NAME_RE})`);
  const meta = ensureMeta(name);
  const now = Date.now();
  if (meta.deletedAt) { meta.deletedAt = null; sceneIndex.set(name, meta); } // using a trashed canvas revives it
  const last = touchAt.get(name) ?? 0;
  if (now - last > TOUCH_THROTTLE_MS) {
    touchAt.set(name, now);
    meta.lastUsedAt = new Date().toISOString();
    sceneIndex.set(name, meta);
  }
  return mapsFor(name);
}

export function createScene(name: string): { meta: SceneMeta; created: boolean } {
  if (!isValidSceneName(name)) throw new Error(`Invalid scene name "${name}"`);
  const existing = sceneIndex.get(name);
  if (existing && !existing.deletedAt) return { meta: existing, created: false };
  const meta: SceneMeta = { name, createdAt: new Date().toISOString(), lastUsedAt: new Date().toISOString(), deletedAt: null };
  sceneIndex.set(name, meta);
  return { meta, created: true };
}

export function listScenes(opts: { includeDeleted?: boolean } = {}): SceneMeta[] {
  const all = Array.from(sceneIndex.values());
  return opts.includeDeleted === false ? all.filter(m => !m.deletedAt) : all;
}

/** Soft-delete → recycle bin. Data rows kept under scene:<name>:* until purge. */
export function deleteScene(name: string): SceneMeta {
  const meta = sceneIndex.get(name);
  if (!meta) throw new Error(`Scene "${name}" not found`);
  if (name === DEFAULT_SCENE) throw new Error('Cannot delete the default scene');
  meta.deletedAt = new Date().toISOString();
  sceneIndex.set(name, meta);
  return meta;
}

export function restoreScene(name: string): SceneMeta {
  const meta = sceneIndex.get(name);
  if (!meta) throw new Error(`Scene "${name}" not found`);
  if (!meta.deletedAt) return meta;
  meta.deletedAt = null;
  sceneIndex.set(name, meta);
  return meta;
}

/** Hard purge: wipe kv rows + live maps + metadata. Irreversible. */
export function purgeScene(name: string): void {
  if (name === DEFAULT_SCENE) throw new Error('Cannot purge the default scene');
  cache.delete(name);
  touchAt.delete(name);
  deletePersistedKey(`scene:${name}:elements`);
  deletePersistedKey(`scene:${name}:snapshots`);
  deletePersistedKey(`scene:${name}:files`);
  sceneIndex.delete(name);
}
