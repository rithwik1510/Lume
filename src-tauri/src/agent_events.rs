// Agent-event spool watcher (Plan 008 §2/§3).
//
// The installed hook shim (assets/lume-hook.cmd, materialized next to the
// OSC-133 script in %APPDATA%\lume) appends each Claude Code lifecycle event —
// the raw hook JSON, one line — to a per-pane spool file:
//
//   %APPDATA%\lume\agent-events\<LUME_PANE_ID>.jsonl
//
// This module owns the read side: a `notify` watcher on the spool dir (same
// debounce shape as config.rs), a per-file read offset so re-reads only see
// appended bytes, and a parser for the handful of contract fields Lume needs.
// Each complete line becomes a Tauri `agent-event` emission the frontend
// agentTracker consumes. Malformed lines are logged at WARN and skipped —
// the same tolerance stance config.rs takes toward unknown keys.
//
// The spool is disposable: pane ids are remapped fresh every launch, so any
// file present at boot belongs to a dead pane — the boot sweep clears them.
// A pane's file is deleted on pty_kill.

use std::collections::HashMap;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, Instant};

use notify::{
    Config as NotifyConfig, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher,
};
use parking_lot::Mutex;
use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Emitter};

use crate::config::config_dir;
use crate::error::{AppError, AppResult};

/// Subdirectory (under %APPDATA%\lume) holding one .jsonl spool per pane.
pub const SPOOL_SUBDIR: &str = "agent-events";
/// Materialized shim filename (lives directly under %APPDATA%\lume so its
/// `%~dp0agent-events` resolves to SPOOL_SUBDIR).
pub const HOOK_SHIM_NAME: &str = "lume-hook.cmd";

/// Debounce window for the spool watcher — matches config.rs. Events are
/// low-frequency (per turn) but a single append can still surface as a burst
/// of raw notify events; collapse them.
const DEBOUNCE_MS: u64 = 120;

const HOOK_SHIM: &str = include_str!("../assets/lume-hook.cmd");

/// Held for the process lifetime so the watcher thread keeps running (mirrors
/// config.rs's ConfigWatcherState). Registered as Tauri managed state.
#[derive(Default)]
pub struct AgentEventsState(pub Mutex<Option<RecommendedWatcher>>);

pub fn spool_dir() -> AppResult<PathBuf> {
    Ok(config_dir()?.join(SPOOL_SUBDIR))
}

/// Absolute path of the materialized hook shim (used by the settings-side
/// hook installer as the marker command string).
pub fn hook_shim_path() -> AppResult<PathBuf> {
    Ok(config_dir()?.join(HOOK_SHIM_NAME))
}

/// Write the shim out (rewritten every launch, like shell_integration.rs, so
/// app updates ship new shim versions with no migration). Ensures the config
/// dir exists. Returns the shim path.
pub fn materialize_hook_shim() -> AppResult<PathBuf> {
    let dir = config_dir()?;
    std::fs::create_dir_all(&dir)
        .map_err(|e| AppError::internal(format!("create_dir_all {}: {}", dir.display(), e)))?;
    let path = dir.join(HOOK_SHIM_NAME);
    std::fs::write(&path, HOOK_SHIM)
        .map_err(|e| AppError::internal(format!("write hook shim {}: {}", path.display(), e)))?;
    Ok(path)
}

/// Delete every stale spool file at boot. Pane ids are remapped fresh each
/// launch (sessionsStore.remapSessionPaneIds), so any file here is from a dead
/// pane and its bytes would misattribute to whatever pane later reuses the id.
pub fn sweep_spool_dir() -> AppResult<()> {
    let dir = spool_dir()?;
    if !dir.exists() {
        return Ok(());
    }
    let entries = std::fs::read_dir(&dir)
        .map_err(|e| AppError::internal(format!("read_dir {}: {}", dir.display(), e)))?;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) == Some("jsonl") {
            if let Err(e) = std::fs::remove_file(&path) {
                log::warn!("agent-events: could not sweep {}: {}", path.display(), e);
            }
        }
    }
    Ok(())
}

/// Delete one pane's spool file (called on pty_kill). Absent file is fine.
pub fn delete_spool_for_pane(pane_id: &str) {
    let path = match spool_dir() {
        Ok(dir) => dir.join(format!("{pane_id}.jsonl")),
        Err(_) => return,
    };
    if path.exists() {
        if let Err(e) = std::fs::remove_file(&path) {
            log::warn!("agent-events: could not delete {}: {}", path.display(), e);
        }
    }
}

// ---------------------------------------------------------------------------
// Pure parsing (unit-tested without a watcher)
// ---------------------------------------------------------------------------

/// The parsed contract fields for one hook line — mirrors the frontend's
/// pinned `agent-event` payload. Serialized camelCase for the Tauri emit.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentEventPayload {
    pub pane_id: String,
    pub event: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kind: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub transcript_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cwd: Option<String>,
}

fn str_field(v: &Value, key: &str) -> Option<String> {
    v.get(key)
        .and_then(|x| x.as_str())
        .map(|s| s.to_string())
        .filter(|s| !s.is_empty())
}

/// Best-effort Notification kind. Claude Code's stdin does not carry the
/// matcher name (we install one Notification entry with matcher ""), so we
/// prefer any explicit field a future version might add, then fall back to
/// classifying the human `message`. Non-Notification events have no kind.
/// Unknown shapes forward whatever string is present — the frontend tolerates
/// unknown kinds silently (forward compatibility, Plan 008 §5).
fn classify_kind(v: &Value, event: &str) -> Option<String> {
    if event != "Notification" {
        return None;
    }
    if let Some(explicit) = str_field(v, "notification_type").or_else(|| str_field(v, "matcher")) {
        return Some(explicit);
    }
    let msg = str_field(v, "message")?;
    let lower = msg.to_lowercase();
    if lower.contains("permission") || lower.contains("approve") || lower.contains("allow") {
        Some("permission_prompt".to_string())
    } else if lower.contains("waiting") || lower.contains("idle") {
        Some("idle_prompt".to_string())
    } else {
        // Forward the raw message so the frontend can decide / ignore.
        Some(msg)
    }
}

/// Parse one spool line into a payload. Returns None for blank or malformed
/// lines (caller logs WARN + skips) and for lines missing the required
/// `hook_event_name`.
pub fn parse_event_line(pane_id: &str, line: &str) -> Option<AgentEventPayload> {
    let line = line.trim();
    if line.is_empty() {
        return None;
    }
    let v: Value = serde_json::from_str(line).ok()?;
    let event = str_field(&v, "hook_event_name")?;
    let kind = classify_kind(&v, &event);
    Some(AgentEventPayload {
        pane_id: pane_id.to_string(),
        event,
        kind,
        session_id: str_field(&v, "session_id"),
        transcript_path: str_field(&v, "transcript_path"),
        cwd: str_field(&v, "cwd"),
    })
}

/// Split a byte buffer into complete (newline-terminated) lines, returning the
/// lines and the number of bytes consumed up to and including the last
/// newline. A trailing partial line (no newline yet) is left unconsumed so the
/// next read picks it up whole — the offset only advances past complete lines.
pub fn split_complete_lines(buf: &[u8]) -> (Vec<String>, usize) {
    let mut last_nl: Option<usize> = None;
    for (i, b) in buf.iter().enumerate() {
        if *b == b'\n' {
            last_nl = Some(i);
        }
    }
    let Some(end) = last_nl else {
        return (Vec::new(), 0);
    };
    let consumed = end + 1;
    let text = String::from_utf8_lossy(&buf[..consumed]);
    let lines = text
        .split('\n')
        .filter(|l| !l.trim().is_empty())
        .map(|l| l.to_string())
        .collect();
    (lines, consumed)
}

fn pane_id_from_path(path: &Path) -> Option<String> {
    if path.extension().and_then(|e| e.to_str()) != Some("jsonl") {
        return None;
    }
    path.file_stem()
        .and_then(|s| s.to_str())
        .map(|s| s.to_string())
}

/// Read appended bytes from `path` starting at `offset`, parse complete lines,
/// and emit each as an `agent-event`. Returns the advanced offset. On any IO
/// error the offset is returned unchanged so the next tick retries.
fn drain_file(app: &AppHandle, path: &Path, offset: u64) -> u64 {
    let Some(pane_id) = pane_id_from_path(path) else {
        return offset;
    };
    let mut file = match std::fs::File::open(path) {
        Ok(f) => f,
        Err(_) => return offset,
    };
    // A truncated/replaced file (e.g. deleted then recreated smaller) resets
    // our offset so we don't seek past its end.
    let len = file.metadata().map(|m| m.len()).unwrap_or(0);
    let start = offset.min(len);
    if file.seek(SeekFrom::Start(start)).is_err() {
        return offset;
    }
    let mut buf = Vec::new();
    if file.read_to_end(&mut buf).is_err() {
        return offset;
    }
    let (lines, consumed) = split_complete_lines(&buf);
    for line in lines {
        match parse_event_line(&pane_id, &line) {
            Some(payload) => {
                if let Err(e) = app.emit("agent-event", &payload) {
                    log::warn!("agent-events: emit failed for pane {pane_id}: {e}");
                }
            }
            None => log::warn!("agent-events: malformed spool line for pane {pane_id}: {line}"),
        }
    }
    start + consumed as u64
}

/// Scan every spool file, draining appended lines from each tracked offset.
fn drain_all(app: &AppHandle, offsets: &Mutex<HashMap<PathBuf, u64>>) {
    let dir = match spool_dir() {
        Ok(d) => d,
        Err(_) => return,
    };
    let entries = match std::fs::read_dir(&dir) {
        Ok(e) => e,
        Err(_) => return,
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if pane_id_from_path(&path).is_none() {
            continue;
        }
        let offset = offsets.lock().get(&path).copied().unwrap_or(0);
        let next = drain_file(app, &path, offset);
        offsets.lock().insert(path, next);
    }
}

/// Start the spool watcher. Ensures the dir exists, sweeps stale files,
/// materializes the shim, then watches the dir with a trailing-edge debounce
/// (same structure as config.rs::watch_config). Called once at app setup.
pub fn start_watcher(app: AppHandle) -> AppResult<RecommendedWatcher> {
    let dir = spool_dir()?;
    std::fs::create_dir_all(&dir)
        .map_err(|e| AppError::internal(format!("create_dir_all {}: {}", dir.display(), e)))?;

    let offsets: Arc<Mutex<HashMap<PathBuf, u64>>> = Arc::new(Mutex::new(HashMap::new()));
    let last_event_at: Arc<Mutex<Instant>> = Arc::new(Mutex::new(Instant::now()));
    let dispatcher_armed = Arc::new(std::sync::atomic::AtomicBool::new(false));

    let mut watcher = notify::recommended_watcher(move |res: notify::Result<Event>| {
        let Ok(event) = res else { return };
        if !matches!(
            event.kind,
            EventKind::Create(_) | EventKind::Modify(_) | EventKind::Remove(_)
        ) {
            return;
        }
        {
            let mut t = last_event_at.lock();
            *t = Instant::now();
        }
        if !dispatcher_armed.swap(true, std::sync::atomic::Ordering::SeqCst) {
            let last_event_at = last_event_at.clone();
            let dispatcher_armed = dispatcher_armed.clone();
            let offsets = offsets.clone();
            let app = app.clone();
            std::thread::spawn(move || {
                loop {
                    std::thread::sleep(Duration::from_millis(DEBOUNCE_MS));
                    let elapsed = { last_event_at.lock().elapsed() };
                    if elapsed >= Duration::from_millis(DEBOUNCE_MS) {
                        break;
                    }
                }
                dispatcher_armed.store(false, std::sync::atomic::Ordering::SeqCst);
                drain_all(&app, &offsets);
            });
        }
    })
    .map_err(|e| AppError::internal(format!("agent-events watcher create: {e}")))?;

    watcher
        .configure(NotifyConfig::default().with_compare_contents(false))
        .map_err(|e| AppError::internal(format!("agent-events watcher config: {e}")))?;
    watcher
        .watch(&dir, RecursiveMode::NonRecursive)
        .map_err(|e| AppError::internal(format!("watch {}: {}", dir.display(), e)))?;
    Ok(watcher)
}

// ---------------------------------------------------------------------------
// Tests — pure parsing + offset tracking (no watcher, no filesystem)
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_session_start_with_identity() {
        let line = r#"{"hook_event_name":"SessionStart","session_id":"abc","transcript_path":"/t.jsonl","cwd":"/proj","source":"startup"}"#;
        let p = parse_event_line("pane-7", line).unwrap();
        assert_eq!(p.pane_id, "pane-7");
        assert_eq!(p.event, "SessionStart");
        assert_eq!(p.session_id.as_deref(), Some("abc"));
        assert_eq!(p.transcript_path.as_deref(), Some("/t.jsonl"));
        assert_eq!(p.cwd.as_deref(), Some("/proj"));
        assert_eq!(p.kind, None); // non-Notification carries no kind
    }

    #[test]
    fn ignores_unknown_extra_fields() {
        // Richer payloads (prompt, last_assistant_message, …) are fine — we
        // parse only the contract fields and ignore the rest.
        let line = r#"{"hook_event_name":"UserPromptSubmit","session_id":"s","prompt":"do the thing","extra":{"a":1}}"#;
        let p = parse_event_line("pane-1", line).unwrap();
        assert_eq!(p.event, "UserPromptSubmit");
        assert_eq!(p.session_id.as_deref(), Some("s"));
    }

    #[test]
    fn classifies_permission_notification_from_message() {
        let line = r#"{"hook_event_name":"Notification","message":"Claude needs your permission to use Bash"}"#;
        let p = parse_event_line("pane-1", line).unwrap();
        assert_eq!(p.kind.as_deref(), Some("permission_prompt"));
    }

    #[test]
    fn classifies_idle_notification_from_message() {
        let line =
            r#"{"hook_event_name":"Notification","message":"Claude is waiting for your input"}"#;
        let p = parse_event_line("pane-1", line).unwrap();
        assert_eq!(p.kind.as_deref(), Some("idle_prompt"));
    }

    #[test]
    fn prefers_explicit_notification_type_field() {
        let line = r#"{"hook_event_name":"Notification","notification_type":"permission_prompt","message":"anything"}"#;
        let p = parse_event_line("pane-1", line).unwrap();
        assert_eq!(p.kind.as_deref(), Some("permission_prompt"));
    }

    #[test]
    fn malformed_and_blank_lines_return_none() {
        assert!(parse_event_line("pane-1", "not json").is_none());
        assert!(parse_event_line("pane-1", "   ").is_none());
        assert!(parse_event_line("pane-1", "").is_none());
        // Missing the required hook_event_name.
        assert!(parse_event_line("pane-1", r#"{"session_id":"x"}"#).is_none());
    }

    #[test]
    fn split_complete_lines_leaves_trailing_partial() {
        let buf = b"{\"a\":1}\n{\"b\":2}\n{\"partial\":";
        let (lines, consumed) = split_complete_lines(buf);
        assert_eq!(lines.len(), 2);
        assert_eq!(consumed, 16); // two 8-byte lines incl. their newlines
        assert_eq!(lines[0], "{\"a\":1}");
        assert_eq!(lines[1], "{\"b\":2}");
    }

    #[test]
    fn split_complete_lines_no_newline_consumes_nothing() {
        let (lines, consumed) = split_complete_lines(b"{\"partial\":true}");
        assert!(lines.is_empty());
        assert_eq!(consumed, 0);
    }

    #[test]
    fn split_complete_lines_skips_blank_interior_lines() {
        let (lines, consumed) = split_complete_lines(b"a\n\n\nb\n");
        assert_eq!(lines, vec!["a".to_string(), "b".to_string()]);
        assert_eq!(consumed, 6);
    }

    #[test]
    fn offset_advances_only_past_complete_lines() {
        // Simulate two successive appends: first a whole line + partial, then
        // the rest of the partial. The offset math must never lose bytes.
        let first = b"{\"hook_event_name\":\"Stop\"}\n{\"hook_event_name\":\"Ses";
        let (lines1, consumed1) = split_complete_lines(first);
        assert_eq!(lines1.len(), 1);
        // Second read starts at the unconsumed remainder.
        let remainder = &first[consumed1..];
        let mut combined = remainder.to_vec();
        combined.extend_from_slice(b"sionEnd\"}\n");
        let (lines2, _c2) = split_complete_lines(&combined);
        assert_eq!(lines2.len(), 1);
        assert_eq!(lines2[0], "{\"hook_event_name\":\"SessionEnd\"}");
    }

    #[test]
    fn pane_id_from_path_reads_stem() {
        assert_eq!(
            pane_id_from_path(Path::new("/x/agent-events/pane-101.jsonl")).as_deref(),
            Some("pane-101")
        );
        assert!(pane_id_from_path(Path::new("/x/notes.txt")).is_none());
    }
}
