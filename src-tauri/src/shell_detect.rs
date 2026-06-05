// Shell auto-detection (DESIGN.md §12 W3 #8).
//
// On Windows we check for pwsh.exe (PowerShell 7+) and powershell.exe
// (Windows PowerShell 5.1) via the `which` crate, plus cmd.exe which is
// always present at %SystemRoot%\System32\cmd.exe. WSL distros come from
// `wsl.exe -l -v` parsing.
//
// Cross-platform note: on macOS/Linux we'd detect /bin/zsh, /bin/bash,
// /usr/local/bin/fish via `which`. Defer cross-platform impl until macOS
// build matters (v0.2).

use serde::Serialize;
#[cfg(target_os = "windows")]
use std::process::Command;

use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ShellDescriptor {
    Pwsh { path: String },
    Powershell { path: String },
    Cmd { path: String },
    Wsl { distro: String },
}

#[cfg(target_os = "windows")]
fn detect_wsl_distros() -> Vec<String> {
    let Ok(output) = Command::new("wsl.exe").args(["-l", "-q"]).output() else {
        return Vec::new();
    };
    if !output.status.success() {
        return Vec::new();
    }
    // wsl.exe -l -q outputs UTF-16LE on Windows. Decode it.
    if output.stdout.len() % 2 != 0 {
        log::warn!(
            "wsl.exe output has odd byte length ({}); trailing byte ignored",
            output.stdout.len()
        );
    }
    let utf16: Vec<u16> = output
        .stdout
        .chunks_exact(2)
        .map(|b| u16::from_le_bytes([b[0], b[1]]))
        .collect();
    let text = String::from_utf16_lossy(&utf16);
    text.lines()
        .map(|l| l.trim().to_string())
        .filter(|l| !l.is_empty() && l.to_lowercase() != "docker-desktop")
        .collect()
}

#[cfg(not(target_os = "windows"))]
fn detect_wsl_distros() -> Vec<String> {
    Vec::new()
}

#[tauri::command]
pub fn detect_shells() -> AppResult<Vec<ShellDescriptor>> {
    let mut out = Vec::new();
    if let Ok(p) = which::which("pwsh") {
        out.push(ShellDescriptor::Pwsh {
            path: p.to_string_lossy().to_string(),
        });
    }
    if let Ok(p) = which::which("powershell") {
        out.push(ShellDescriptor::Powershell {
            path: p.to_string_lossy().to_string(),
        });
    }
    if let Ok(p) = which::which("cmd") {
        out.push(ShellDescriptor::Cmd {
            path: p.to_string_lossy().to_string(),
        });
    }
    for distro in detect_wsl_distros() {
        out.push(ShellDescriptor::Wsl { distro });
    }
    if out.is_empty() {
        return Err(AppError::Internal {
            reason: "no shells detected".to_string(),
        });
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detect_shells_includes_at_least_one_on_test_host() {
        // CI runs on windows-latest which always has cmd.exe at minimum.
        let shells = detect_shells().unwrap();
        assert!(!shells.is_empty());
    }
}
