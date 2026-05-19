// PTY infrastructure for Workstation Weekend 1.
//
// Architecture (per DESIGN.md §4 + §6 + §10 risk #2):
//   - One PTY process per pane (paneId-keyed).
//   - Each pane owns a Channel<PtyEvent> back to the JS side.
//   - Reader thread: pulls bytes off the PTY into a per-pane ring buffer
//     (8 MB cap; drop-oldest on overflow).
//   - Flusher thread: every 32 ms, drains the ring buffer and emits a
//     PtyEvent::Data via the Channel. Coalesces high-frequency PTY output
//     into one IPC call per 32 ms.
//   - Waiter thread: blocks on child.wait(); emits PtyEvent::Exit when done.
//
// PaneId-keyed lifecycle (DESIGN.md §4 rule #2): the React side calls
// pty_open with a paneId. The Rust side stashes handles in a DashMap keyed
// by that id. pty_kill removes the entry and drops everything; the threads
// notice the disconnected channel / dropped reader and exit cleanly.

use std::collections::VecDeque;
use std::io::{Read, Write};
use std::sync::Arc;
use std::thread;
use std::time::Duration;

use dashmap::DashMap;
use parking_lot::Mutex;
use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use serde::{Deserialize, Serialize};
use tauri::ipc::Channel;
use tauri::State;

use crate::error::{AppError, AppResult};

/// Per-pane batching window. PTY reads are coalesced into one IPC call
/// every FLUSH_INTERVAL_MS. Match this to DESIGN.md §6 terminal.ipc_batch_ms.
const FLUSH_INTERVAL_MS: u64 = 32;

/// Per-pane ring buffer cap. Match to DESIGN.md §6 terminal.ring_buffer_mb.
const RING_BUFFER_BYTES: usize = 8 * 1024 * 1024;

/// Shell selector — must match src/types/index.ts Shell discriminated union.
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum Shell {
    Pwsh { path: String },
    Powershell { path: String },
    Cmd { path: String },
    Wsl { distro: String },
}

/// Outbound channel event — mirrors src/types/index.ts PtyEvent.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum PtyEvent {
    Data { bytes: Vec<u8> },
    Exit { code: Option<i32> },
    Error { error: AppError },
}

/// Bounded byte ring with drop-oldest overflow.
/// Used to bound memory between PTY reads and the 32ms IPC flush.
#[derive(Debug)]
pub struct RingBuf {
    cap: usize,
    inner: VecDeque<u8>,
}

impl RingBuf {
    pub fn new(cap: usize) -> Self {
        Self { cap, inner: VecDeque::with_capacity(cap.min(64 * 1024)) }
    }

    /// Append bytes; if over capacity, drop the oldest until it fits.
    /// If `bytes` is itself larger than `cap`, only the last `cap` are kept.
    pub fn push(&mut self, bytes: &[u8]) {
        if bytes.len() >= self.cap {
            self.inner.clear();
            self.inner.extend(&bytes[bytes.len() - self.cap..]);
            return;
        }
        let overflow = (self.inner.len() + bytes.len()).saturating_sub(self.cap);
        if overflow > 0 {
            self.inner.drain(..overflow);
        }
        self.inner.extend(bytes);
    }

    /// Take and return all buffered bytes.
    pub fn drain_all(&mut self) -> Vec<u8> {
        let n = self.inner.len();
        let mut out = Vec::with_capacity(n);
        out.extend(self.inner.drain(..));
        out
    }

    pub fn len(&self) -> usize {
        self.inner.len()
    }

    pub fn is_empty(&self) -> bool {
        self.inner.is_empty()
    }
}

/// Per-pane runtime handles.
///
/// Each field that holds a non-Sync trait object is wrapped in `Mutex` so
/// the whole session is `Send + Sync`, which is required for storage in
/// `DashMap<String, PtySession>` and ultimately for `State<PtyRegistry>`.
struct PtySession {
    master: Mutex<Box<dyn MasterPty + Send>>,
    writer: Mutex<Box<dyn Write + Send>>,
    /// Set by pty_kill (and reader thread on EOF) to tell the flusher to stop.
    closed: Arc<Mutex<bool>>,
}

/// App state — keyed by paneId. Inserted on pty_open, removed on pty_kill.
#[derive(Default)]
pub struct PtyRegistry {
    sessions: DashMap<String, PtySession>,
}

/// Resolved program + args for a shell. Separated from CommandBuilder so we
/// can unit-test the mapping without reflecting on CommandBuilder internals.
#[derive(Debug, PartialEq, Eq)]
pub struct CommandSpec {
    pub program: String,
    pub args: Vec<String>,
}

pub fn shell_spec(shell: &Shell) -> CommandSpec {
    match shell {
        Shell::Pwsh { path }
        | Shell::Powershell { path }
        | Shell::Cmd { path } => CommandSpec { program: path.clone(), args: vec![] },
        Shell::Wsl { distro } => CommandSpec {
            program: "wsl.exe".to_string(),
            args: vec!["-d".to_string(), distro.clone()],
        },
    }
}

fn build_command(shell: &Shell) -> CommandBuilder {
    let spec = shell_spec(shell);
    let mut cmd = CommandBuilder::new(spec.program);
    if !spec.args.is_empty() {
        cmd.args(spec.args);
    }
    cmd
}

#[tauri::command]
pub fn pty_open(
    pane_id: String,
    shell: Shell,
    cols: u16,
    rows: u16,
    channel: Channel<PtyEvent>,
    state: State<'_, PtyRegistry>,
) -> AppResult<()> {
    // Idempotency: re-opening with the same paneId tears down the prior
    // session first. Prevents leaks if the React side double-fires.
    if state.sessions.contains_key(&pane_id) {
        state.sessions.remove(&pane_id);
    }

    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
        .map_err(|e| AppError::spawn(format!("openpty: {e}")))?;

    let cmd = build_command(&shell);
    let mut child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| AppError::spawn(format!("spawn: {e}")))?;

    drop(pair.slave);

    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| AppError::spawn(format!("clone_reader: {e}")))?;

    let writer = pair
        .master
        .take_writer()
        .map_err(|e| AppError::spawn(format!("take_writer: {e}")))?;

    let closed = Arc::new(Mutex::new(false));
    let ring = Arc::new(Mutex::new(RingBuf::new(RING_BUFFER_BYTES)));

    state.sessions.insert(
        pane_id.clone(),
        PtySession {
            master: Mutex::new(pair.master),
            writer: Mutex::new(writer),
            closed: closed.clone(),
        },
    );

    // Reader thread: PTY → ring buffer.
    {
        let ring = ring.clone();
        let closed = closed.clone();
        thread::spawn(move || {
            let mut buf = [0u8; 64 * 1024];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        ring.lock().push(&buf[..n]);
                    }
                    Err(_) => break,
                }
            }
            *closed.lock() = true;
        });
    }

    // Flusher thread: ring buffer → Channel, every 32 ms.
    {
        let ring = ring.clone();
        let closed = closed.clone();
        let ch = channel.clone();
        thread::spawn(move || loop {
            thread::sleep(Duration::from_millis(FLUSH_INTERVAL_MS));
            let drained = {
                let mut r = ring.lock();
                if r.is_empty() {
                    if *closed.lock() {
                        break;
                    }
                    continue;
                }
                r.drain_all()
            };
            if ch.send(PtyEvent::Data { bytes: drained }).is_err() {
                break;
            }
            if *closed.lock() {
                // One final flush in case bytes arrived between the drain
                // and the closed-flag check.
                let tail = ring.lock().drain_all();
                if !tail.is_empty() {
                    let _ = ch.send(PtyEvent::Data { bytes: tail });
                }
                break;
            }
        });
    }

    // Waiter thread: emit Exit when child terminates.
    {
        let ch = channel;
        thread::spawn(move || {
            let code = match child.wait() {
                Ok(s) => Some(s.exit_code() as i32),
                Err(_) => None,
            };
            let _ = ch.send(PtyEvent::Exit { code });
        });
    }

    Ok(())
}

#[tauri::command]
pub fn pty_write(
    pane_id: String,
    data: String,
    state: State<'_, PtyRegistry>,
) -> AppResult<()> {
    let session = state
        .sessions
        .get(&pane_id)
        .ok_or_else(|| AppError::not_found(&pane_id))?;
    let mut w = session.writer.lock();
    w.write_all(data.as_bytes())
        .map_err(|e| AppError::write(e.to_string()))?;
    w.flush().map_err(|e| AppError::write(e.to_string()))?;
    Ok(())
}

#[tauri::command]
pub fn pty_resize(
    pane_id: String,
    cols: u16,
    rows: u16,
    state: State<'_, PtyRegistry>,
) -> AppResult<()> {
    let session = state
        .sessions
        .get(&pane_id)
        .ok_or_else(|| AppError::not_found(&pane_id))?;
    let m = session.master.lock();
    m.resize(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
        .map_err(|e| AppError::resize(e.to_string()))?;
    Ok(())
}

#[tauri::command]
pub fn pty_kill(pane_id: String, state: State<'_, PtyRegistry>) -> AppResult<()> {
    if let Some((_, session)) = state.sessions.remove(&pane_id) {
        *session.closed.lock() = true;
        // Dropping `session` drops master + writer; reader sees EOF and exits.
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ringbuf_basic_push_and_drain() {
        let mut r = RingBuf::new(100);
        r.push(b"hello");
        assert_eq!(r.len(), 5);
        assert_eq!(r.drain_all(), b"hello");
        assert!(r.is_empty());
    }

    #[test]
    fn ringbuf_drops_oldest_on_overflow() {
        let mut r = RingBuf::new(5);
        r.push(b"abc");
        r.push(b"de");
        // Capacity now 5/5 with "abcde"
        r.push(b"fg");
        // Dropped "ab", retained "cdefg"
        assert_eq!(r.drain_all(), b"cdefg");
    }

    #[test]
    fn ringbuf_single_push_larger_than_cap_keeps_last_cap_bytes() {
        let mut r = RingBuf::new(3);
        r.push(b"abcdefg");
        assert_eq!(r.drain_all(), b"efg");
    }

    #[test]
    fn ringbuf_drain_resets_to_empty() {
        let mut r = RingBuf::new(10);
        r.push(b"xyz");
        let _ = r.drain_all();
        assert_eq!(r.len(), 0);
        assert!(r.is_empty());
        r.push(b"abc");
        assert_eq!(r.drain_all(), b"abc");
    }

    #[test]
    fn shell_spec_wsl_uses_explicit_distro() {
        let s = Shell::Wsl { distro: "Ubuntu".to_string() };
        let spec = shell_spec(&s);
        assert_eq!(spec.program, "wsl.exe");
        assert_eq!(spec.args, vec!["-d".to_string(), "Ubuntu".to_string()]);
    }

    #[test]
    fn shell_spec_pwsh_uses_provided_path() {
        let s = Shell::Pwsh {
            path: "C:\\Program Files\\PowerShell\\7\\pwsh.exe".to_string(),
        };
        let spec = shell_spec(&s);
        assert!(spec.program.ends_with("pwsh.exe"));
        assert!(spec.args.is_empty());
    }

    #[test]
    fn shell_spec_powershell_and_cmd_have_no_args() {
        let p = Shell::Powershell { path: "powershell.exe".into() };
        assert!(shell_spec(&p).args.is_empty());
        let c = Shell::Cmd { path: "cmd.exe".into() };
        assert!(shell_spec(&c).args.is_empty());
    }
}
