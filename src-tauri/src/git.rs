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

const TIMEOUT: Duration = Duration::from_secs(2);

#[tauri::command]
pub fn git_current_branch(path: String) -> Option<String> {
    let (tx, rx) = mpsc::channel();
    thread::spawn(move || {
        let result = Command::new("git")
            .args(["rev-parse", "--abbrev-ref", "HEAD"])
            .current_dir(&path)
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .output();
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
