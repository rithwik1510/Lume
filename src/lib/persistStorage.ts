// src/lib/persistStorage.ts
//
// Adapter implementing Zustand's StateStorage interface backed by
// @tauri-apps/plugin-store. localStorage is webview-scoped and size-limited;
// the Tauri Store plugin writes JSON to disk atomically via Rust, in the
// platform config dir (DESIGN.md §4).
//
// Storage layout: one Tauri store file per Zustand slice. Names are kept
// stable so the persisted format is portable across app versions; bump the
// `version` field in each store's persist config to migrate.

import { load, type Store } from "@tauri-apps/plugin-store";
import type { StateStorage } from "zustand/middleware";

/** Cache the loaded Store handles by file name so each Zustand persist
 *  middleware sees the same instance. */
const storeCache = new Map<string, Promise<Store>>();

function getStore(filename: string): Promise<Store> {
  let p = storeCache.get(filename);
  if (!p) {
    // autoSave defaults to 100ms — we rely on that. Don't pass options so we
    // don't have to declare `defaults` (the plugin requires it when the
    // options object is present).
    p = load(filename);
    storeCache.set(filename, p);
  }
  return p;
}

export function tauriPersistStorage(filename: string): StateStorage {
  return {
    async getItem(name: string): Promise<string | null> {
      const store = await getStore(filename);
      const v = await store.get<string>(name);
      return v ?? null;
    },
    async setItem(name: string, value: string): Promise<void> {
      const store = await getStore(filename);
      await store.set(name, value);
    },
    async removeItem(name: string): Promise<void> {
      const store = await getStore(filename);
      await store.delete(name);
    },
  };
}
