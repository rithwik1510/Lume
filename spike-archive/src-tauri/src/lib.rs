// Workstation Weekend 0 spike — Rust side.
//
// One job: spawn a WSL pty, stream stdout/stderr bytes to the webview via
// tauri::ipc::Channel, accept keystrokes back via pty_write, accept resizes
// via pty_resize. No layout tree, no stores — that's Weekend 1+.

use std::io::{Read, Write};
use std::sync::Arc;
use std::thread;

use parking_lot::Mutex;
use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use tauri::ipc::Channel;
use tauri::State;

#[derive(Serialize, Clone)]
#[serde(tag = "kind", rename_all = "snake_case")]
enum PtyEvent {
    // Bytes flow as number[] over Tauri's JSON IPC for the spike. If profiling
    // shows this is the bottleneck under heavy load we switch to binary IPC
    // (tauri::ipc::Response with InvokeResponseBody::Raw). Per DESIGN.md, the
    // critical invariant is that PTY bytes never touch React state — we satisfy
    // that already by writing straight to xterm in channel.onmessage.
    Data { bytes: Vec<u8> },
    Exit { code: Option<i32> },
}

struct PtyHandles {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
}

#[derive(Default)]
struct PtyState {
    inner: Arc<Mutex<Option<PtyHandles>>>,
}

#[tauri::command]
fn pty_open(
    channel: Channel<PtyEvent>,
    cols: u16,
    rows: u16,
    state: State<'_, PtyState>,
) -> Result<(), String> {
    // Tear down any prior PTY first so re-invocation during HMR is safe.
    {
        let mut guard = state.inner.lock();
        *guard = None;
    }

    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("openpty failed: {e}"))?;

    // Explicitly target Ubuntu — the user's default WSL distro is
    // docker-desktop, which we don't want. Ubuntu is where Claude Code lives.
    let mut cmd = CommandBuilder::new("wsl.exe");
    cmd.args(["-d", "Ubuntu"]);

    let mut child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("spawn wsl failed: {e}"))?;

    // Drop slave handle in the parent — the child owns it now.
    drop(pair.slave);

    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| format!("clone reader failed: {e}"))?;

    let writer = pair
        .master
        .take_writer()
        .map_err(|e| format!("take writer failed: {e}"))?;

    {
        let mut guard = state.inner.lock();
        *guard = Some(PtyHandles {
            master: pair.master,
            writer,
        });
    }

    // Reader thread. Pull bytes off the PTY, push them down the Channel.
    let reader_channel = channel.clone();
    thread::spawn(move || {
        let mut buf = [0u8; 8192];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    let evt = PtyEvent::Data {
                        bytes: buf[..n].to_vec(),
                    };
                    if reader_channel.send(evt).is_err() {
                        break;
                    }
                }
                Err(_) => break,
            }
        }
    });

    // Waiter thread. Watches the child; emits Exit when it dies.
    let waiter_channel = channel;
    thread::spawn(move || {
        let code = match child.wait() {
            Ok(status) => status.exit_code() as i32,
            Err(_) => -1,
        };
        let _ = waiter_channel.send(PtyEvent::Exit {
            code: Some(code),
        });
    });

    Ok(())
}

#[tauri::command]
fn pty_write(data: String, state: State<'_, PtyState>) -> Result<(), String> {
    let mut guard = state.inner.lock();
    let handles = guard.as_mut().ok_or("pty not open")?;
    handles
        .writer
        .write_all(data.as_bytes())
        .map_err(|e| format!("write failed: {e}"))?;
    handles
        .writer
        .flush()
        .map_err(|e| format!("flush failed: {e}"))?;
    Ok(())
}

#[tauri::command]
fn pty_resize(cols: u16, rows: u16, state: State<'_, PtyState>) -> Result<(), String> {
    let guard = state.inner.lock();
    let handles = guard.as_ref().ok_or("pty not open")?;
    handles
        .master
        .resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("resize failed: {e}"))?;
    Ok(())
}

#[tauri::command]
fn pty_kill(state: State<'_, PtyState>) -> Result<(), String> {
    let mut guard = state.inner.lock();
    *guard = None; // Drop master+writer; child dies when PTY closes.
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(PtyState::default())
        .invoke_handler(tauri::generate_handler![
            pty_open,
            pty_write,
            pty_resize,
            pty_kill
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
