// src/lib/updater.ts
//
// In-app auto-update. Runs ONCE at boot in release builds. On finding an
// update it asks via the existing confirm dialog, then downloads, installs and
// relaunches. Any failure degrades to a warn toast — it never blocks startup.
// In dev there is no updater endpoint, so callers guard on import.meta.env.PROD.

import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

import { useConfirmStore } from "@/store/confirmStore";
import { useToastStore } from "@/store/toastStore";

export async function checkForUpdatesOnLaunch(): Promise<void> {
  try {
    const update = await check();
    if (!update) return;

    const ok = await useConfirmStore.getState().confirm({
      title: `Update available — ${update.version}`,
      message: `Lume ${update.version} is ready to install. Update now? The app will restart.`,
      confirmLabel: "Update & restart",
      cancelLabel: "Later",
    });
    if (!ok) return;

    useToastStore.getState().push({
      severity: "info",
      message: `Downloading update ${update.version}…`,
    });
    await update.downloadAndInstall();
    await relaunch();
  } catch (err) {
    useToastStore.getState().push({
      severity: "warn",
      message: `Update check failed: ${err instanceof Error ? err.message : String(err)}`,
    });
  }
}
