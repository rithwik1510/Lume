/** Mirror of Rust `DirEntry` (src-tauri/src/fs.rs). */
export interface DirEntry {
  name: string;
  path: string;
  is_dir: boolean;
  size: number;
  modified_ms: number | null;
}
