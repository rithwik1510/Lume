import { open } from "@tauri-apps/plugin-shell";

/** Open a local file or folder with the operating system's default handler. */
export async function openPath(path: string): Promise<void> {
  await open(path);
}
