// File-watcher Channel wrapper. Mirrors src-tauri/src/file_watcher.rs::FsEvent.
import { Channel, invoke } from "@tauri-apps/api/core";

export type FsEvent =
  | { kind: "created"; path: string }
  | { kind: "modified"; path: string }
  | { kind: "removed"; path: string }
  | { kind: "rescan" };

export function watchWorkspace(root: string, onEvent: (e: FsEvent) => void): void {
  const channel = new Channel<FsEvent>();
  channel.onmessage = onEvent;
  void invoke<void>("watch_workspace", { root, channel });
}
