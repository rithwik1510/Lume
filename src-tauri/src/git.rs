//! `git_current_branch` Tauri command. Runs `git rev-parse --abbrev-ref HEAD`
//! against a folder path with a 2-second timeout. Returns the trimmed branch
//! name on success, None on any failure (not a git repo, missing git binary,
//! deleted folder, detached HEAD, timeout).
//!
//! Wrapped in a thread + mpsc to enforce the timeout because std::process
//! has no native timeout — Command::output() blocks until the child exits.
//! A network/UNC path with a hung `git` would otherwise block the async
//! command worker indefinitely (spec §15 risk #3).

use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::thread;
use std::time::Duration;
#[cfg(windows)]
use std::os::windows::process::CommandExt;

const TIMEOUT: Duration = Duration::from_secs(2);

/// CREATE_NO_WINDOW — without this flag Windows pops a black console window
/// every time the GUI process spawns `git`. The branch poller calls this every
/// few seconds per active session, so the un-flagged spawn flashed a console
/// window repeatedly (looked like "a tab/page popping up and going off").
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[tauri::command]
pub fn git_current_branch(path: String) -> Option<String> {
    let (tx, rx) = mpsc::channel();
    thread::spawn(move || {
        let mut cmd = Command::new("git");
        cmd.args(["rev-parse", "--abbrev-ref", "HEAD"])
            .current_dir(&path)
            .stdout(Stdio::piped())
            .stderr(Stdio::null());
        #[cfg(windows)]
        cmd.creation_flags(CREATE_NO_WINDOW);
        let result = cmd.output();
        // Receiver may already be gone if we timed out — ignore the send error.
        let _ = tx.send(result);
    });
    let output = rx.recv_timeout(TIMEOUT).ok()?.ok()?;
    if !output.status.success() {
        return None;
    }
    let branch = String::from_utf8(output.stdout).ok()?.trim().to_string();
    if branch.is_empty() || branch == "HEAD" {
        // Empty = error. "HEAD" = detached. Treat as no branch.
        return None;
    }
    Some(branch)
}
