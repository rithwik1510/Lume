import { invoke } from "@tauri-apps/api/core";
import type { DirEntry } from "@/types/fs";

export function listDir(path: string): Promise<DirEntry[]> {
  return invoke<DirEntry[]>("list_dir", { path });
}

export function readTextFile(path: string): Promise<string> {
  return invoke<string>("read_text_file", { path });
}

export function writeTextFile(path: string, contents: string): Promise<void> {
  return invoke<void>("write_text_file", { path, contents });
}

export function homeDir(): Promise<string> {
  return invoke<string>("home_dir");
}
