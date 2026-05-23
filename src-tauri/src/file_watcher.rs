// File-watcher Channel for the Sidebar's tree refresh.
//
// Architecture: a single per-Workstation watcher rooted at the current
// workspace folder. When notify emits a fs event for a file/folder, we
// emit a FsEvent over a Tauri Channel that the JS side subscribes to.
// JS picks the parent folder of the changed path, invalidates that
// folder's entries in sidebarStore, and triggers a re-listDir.
//
// notify v6 is debounced internally; we don't add another debounce here.

use notify::{Config, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use parking_lot::Mutex;
use serde::Serialize;
use std::path::PathBuf;
use std::sync::Arc;
use tauri::ipc::Channel;
use tauri::State;

use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum FsEvent {
    Created { path: String },
    Modified { path: String },
    Removed { path: String },
    Rescan,
}

/// Holder for the active watcher. Replaced when workspace folder changes.
#[derive(Default)]
pub struct FileWatcherState(pub Mutex<Option<RecommendedWatcher>>);

#[tauri::command]
pub fn watch_workspace(
    state: State<'_, FileWatcherState>,
    root: String,
    channel: Channel<FsEvent>,
) -> AppResult<()> {
    let channel = Arc::new(channel);
    let chan_clone = channel.clone();
    let mut watcher = notify::recommended_watcher(move |res: notify::Result<Event>| {
        if let Ok(event) = res {
            let path = event
                .paths
                .first()
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_default();
            let out = match event.kind {
                EventKind::Create(_) => FsEvent::Created { path },
                EventKind::Modify(_) => FsEvent::Modified { path },
                EventKind::Remove(_) => FsEvent::Removed { path },
                _ => return,
            };
            let _ = chan_clone.send(out);
        }
    })
    .map_err(|e| AppError::Internal {
        reason: format!("watcher create: {}", e),
    })?;

    watcher
        .configure(Config::default().with_compare_contents(false))
        .map_err(|e| AppError::Internal {
            reason: format!("watcher config: {}", e),
        })?;
    watcher
        .watch(&PathBuf::from(&root), RecursiveMode::Recursive)
        .map_err(|e| AppError::Internal {
            reason: format!("watch {}: {}", root, e),
        })?;

    // Replace any previous watcher (drops the old one, releasing handles).
    *state.0.lock() = Some(watcher);

    // Emit one Rescan so the JS side seeds its tree.
    channel
        .send(FsEvent::Rescan)
        .map_err(|e| AppError::Internal {
            reason: format!("channel send: {}", e),
        })?;
    Ok(())
}
