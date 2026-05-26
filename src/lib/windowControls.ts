// Thin wrappers around @tauri-apps/api/window for the custom titlebar.
// The Tauri v2 API uses `getCurrentWindow()`; we centralise the calls so
// the TopBar component doesn't reach into the Tauri API directly and so
// tests can mock the module.

import { getCurrentWindow } from "@tauri-apps/api/window";

export async function minimizeWindow(): Promise<void> {
  await getCurrentWindow().minimize();
}

export async function toggleMaximize(): Promise<void> {
  const win = getCurrentWindow();
  const maxed = await win.isMaximized();
  if (maxed) await win.unmaximize();
  else await win.maximize();
}

export async function closeWindow(): Promise<void> {
  await getCurrentWindow().close();
}

export async function isMaximized(): Promise<boolean> {
  return getCurrentWindow().isMaximized();
}
