// File-system commands for the Sidebar + MD editor.
//
// SECURITY NOTE: these commands operate with the user's privilege, so
// callers can already do anything the user can. We do NOT sandbox to a
// "workspace root" here — the user explicitly opens files via the
// Sidebar / MD picker, and the spec puts Workspace Folder selection on
// the user (DESIGN.md §3 Workspace Folder). Validation we DO apply:
//   - canonicalise the path so symlink-traversal returns the real path
//   - return a typed AppError on permission / not-found / IO failure

use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};

use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
pub struct DirEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    /// File size in bytes (0 for dirs).
    pub size: u64,
    /// Last modified epoch ms (None if filesystem doesn't expose it).
    pub modified_ms: Option<i64>,
}

/// Strip Windows' `\\?\` verbatim prefix that `fs::canonicalize` adds, so the
/// paths we hand the UI match the *non-verbatim* paths the file watcher emits
/// (`file_watcher.rs`) and the shell's cwd. Without this the Sidebar tree is
/// keyed `\\?\C:\…\docs` while watcher-driven refreshes key plain `C:\…\docs`,
/// so a file the agent just created updates a phantom key and never appears in
/// the tree. No-op on paths without the prefix (and on non-Windows).
fn strip_verbatim(p: &Path) -> String {
    let s = p.to_string_lossy();
    if let Some(rest) = s.strip_prefix(r"\\?\UNC\") {
        format!(r"\\{rest}")
    } else if let Some(rest) = s.strip_prefix(r"\\?\") {
        rest.to_string()
    } else {
        s.into_owned()
    }
}

fn to_entry(entry: &fs::DirEntry) -> AppResult<DirEntry> {
    let meta = entry.metadata().map_err(|e| AppError::Internal {
        reason: format!("metadata {}: {}", entry.path().display(), e),
    })?;
    let modified_ms = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .and_then(|d| i64::try_from(d.as_millis()).ok());
    Ok(DirEntry {
        name: entry.file_name().to_string_lossy().to_string(),
        path: strip_verbatim(&entry.path()),
        is_dir: meta.is_dir(),
        size: if meta.is_dir() { 0 } else { meta.len() },
        modified_ms,
    })
}

#[tauri::command]
pub fn list_dir(path: String) -> AppResult<Vec<DirEntry>> {
    let p = PathBuf::from(&path);
    let canonical = p.canonicalize().map_err(|e| AppError::Internal {
        reason: format!("canonicalize {}: {}", path, e),
    })?;
    let read = fs::read_dir(&canonical).map_err(|e| AppError::Internal {
        reason: format!("read_dir {}: {}", canonical.display(), e),
    })?;
    let mut out = Vec::new();
    for entry in read.flatten() {
        if let Ok(e) = to_entry(&entry) {
            out.push(e);
        }
    }
    // Folders first, then alphabetical within each group. Matches VSCode / Finder default.
    out.sort_by(|a, b| match (a.is_dir, b.is_dir) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });
    Ok(out)
}

#[tauri::command]
pub fn read_text_file(path: String) -> AppResult<String> {
    fs::read_to_string(&path).map_err(|e| AppError::Internal {
        reason: format!("read {}: {}", path, e),
    })
}

#[tauri::command]
pub fn write_text_file(path: String, contents: String) -> AppResult<()> {
    if let Some(parent) = Path::new(&path).parent() {
        if !parent.exists() {
            fs::create_dir_all(parent).map_err(|e| AppError::Internal {
                reason: format!("create_dir_all {}: {}", parent.display(), e),
            })?;
        }
    }
    fs::write(&path, contents).map_err(|e| AppError::Internal {
        reason: format!("write {}: {}", path, e),
    })
}

#[tauri::command]
pub fn home_dir() -> AppResult<String> {
    dirs::home_dir()
        .map(|p| p.to_string_lossy().to_string())
        .ok_or_else(|| AppError::Internal {
            reason: "home dir unavailable".to_string(),
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn list_dir_returns_folders_first_alphabetical() {
        let dir = tempfile::tempdir().unwrap();
        fs::create_dir(dir.path().join("zzz_folder")).unwrap();
        fs::create_dir(dir.path().join("aaa_folder")).unwrap();
        let mut f = fs::File::create(dir.path().join("a_file.md")).unwrap();
        writeln!(f, "hi").unwrap();
        let mut f = fs::File::create(dir.path().join("z_file.md")).unwrap();
        writeln!(f, "hi").unwrap();
        let entries = list_dir(dir.path().to_string_lossy().to_string()).unwrap();
        let names: Vec<&str> = entries.iter().map(|e| e.name.as_str()).collect();
        assert_eq!(
            names,
            vec!["aaa_folder", "zzz_folder", "a_file.md", "z_file.md"]
        );
    }

    #[test]
    fn list_dir_paths_have_no_verbatim_prefix() {
        // Regression: canonicalize() adds `\\?\` on Windows; the watcher emits
        // plain paths. If list_dir leaks the prefix, watcher-driven sidebar
        // refreshes key a different string than the rendered tree and new files
        // never show. Trivially passes on non-Windows (no prefix to add).
        let dir = tempfile::tempdir().unwrap();
        fs::create_dir(dir.path().join("docs")).unwrap();
        fs::File::create(dir.path().join("a.md")).unwrap();
        let entries = list_dir(dir.path().to_string_lossy().to_string()).unwrap();
        assert!(!entries.is_empty());
        for e in &entries {
            assert!(
                !e.path.starts_with(r"\\?\"),
                "entry path leaked verbatim prefix: {}",
                e.path
            );
        }
        let docs = entries.iter().find(|e| e.name == "docs").unwrap();
        assert!(docs.path.ends_with("docs"), "got: {}", docs.path);
    }

    #[test]
    fn strip_verbatim_removes_windows_prefixes() {
        assert_eq!(strip_verbatim(Path::new(r"\\?\C:\a\b")), r"C:\a\b");
        assert_eq!(
            strip_verbatim(Path::new(r"\\?\UNC\srv\share")),
            r"\\srv\share"
        );
        assert_eq!(
            strip_verbatim(Path::new(r"C:\already\plain")),
            r"C:\already\plain"
        );
        assert_eq!(strip_verbatim(Path::new("/unix/style")), "/unix/style");
    }

    #[test]
    fn read_then_write_roundtrips() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("test.md").to_string_lossy().to_string();
        write_text_file(path.clone(), "hello".to_string()).unwrap();
        assert_eq!(read_text_file(path).unwrap(), "hello");
    }
}
