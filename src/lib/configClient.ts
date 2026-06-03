// src/lib/configClient.ts
//
// Wrappers around the Rust config commands. Hot-reload subscription uses
// a Tauri Channel that emits ConfigEvent records when ~/.lume/
// config.toml changes on disk.

import { invoke, Channel } from "@tauri-apps/api/core";
import type { LumeConfig } from "@/types/config";

export function readConfig(): Promise<LumeConfig> {
  return invoke<LumeConfig>("read_config");
}

export function writeDefaultConfigIfMissing(): Promise<boolean> {
  return invoke<boolean>("write_default_config_if_missing");
}

export function configFilePath(): Promise<string> {
  return invoke<string>("config_file_path");
}

export type ConfigEvent = { kind: "changed"; path: string };

/**
 * Subscribe to config-file changes. Returns a no-op unsubscribe placeholder
 * — Tauri Channels are torn down when the receiver is garbage-collected;
 * for v0.1 the watcher lives for the full app lifetime. If you need to
 * stop watching, restart the app.
 */
export async function watchConfig(
  onChange: (event: ConfigEvent) => void
): Promise<() => void> {
  const channel = new Channel<ConfigEvent>();
  channel.onmessage = (e) => onChange(e);
  await invoke<void>("watch_config", { channel });
  return () => {
    // Best-effort: replace the handler with a no-op. The Rust-side watcher
    // continues until the app exits.
    channel.onmessage = () => undefined;
  };
}

/** Set one dotted config key on disk (format-preserving, Rust toml_edit). */
export function setConfigValue(path: string, value: unknown): Promise<void> {
  return invoke<void>("set_config_value", { path, value });
}
