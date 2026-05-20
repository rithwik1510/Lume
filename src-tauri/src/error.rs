// AppError — the single error type returned by every Tauri command.
// Mirrors src/types/index.ts AppError discriminated union exactly.
// To add a variant: add it to BOTH this enum AND the TS union.

use serde::Serialize;

#[derive(Debug, Clone, thiserror::Error, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum AppError {
    #[error("pty spawn failed: {reason}")]
    PtySpawnFailed { reason: String },

    #[error("pty write failed: {reason}")]
    PtyWriteFailed { reason: String },

    #[error("pty resize failed: {reason}")]
    PtyResizeFailed { reason: String },

    #[error("pty not found: {pane_id}")]
    PtyNotFound { pane_id: String },

    #[error("internal error: {reason}")]
    Internal { reason: String },
}

impl AppError {
    pub fn spawn(reason: impl Into<String>) -> Self {
        Self::PtySpawnFailed {
            reason: reason.into(),
        }
    }

    pub fn write(reason: impl Into<String>) -> Self {
        Self::PtyWriteFailed {
            reason: reason.into(),
        }
    }

    pub fn resize(reason: impl Into<String>) -> Self {
        Self::PtyResizeFailed {
            reason: reason.into(),
        }
    }

    pub fn not_found(pane_id: impl Into<String>) -> Self {
        Self::PtyNotFound {
            pane_id: pane_id.into(),
        }
    }

    pub fn internal(reason: impl Into<String>) -> Self {
        Self::Internal {
            reason: reason.into(),
        }
    }
}

/// Tauri-command-friendly result alias.
pub type AppResult<T> = Result<T, AppError>;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn display_format_matches_tagged_serde() {
        let e = AppError::spawn("wsl missing");
        assert_eq!(format!("{e}"), "pty spawn failed: wsl missing");
    }

    #[test]
    fn serializes_with_kind_tag_snake_case() {
        let e = AppError::not_found("pane-3");
        let json = serde_json::to_string(&e).expect("serialize");
        assert_eq!(json, r#"{"kind":"pty_not_found","pane_id":"pane-3"}"#);
    }

    #[test]
    fn serializes_write_variant() {
        let e = AppError::write("broken pipe");
        let json = serde_json::to_string(&e).expect("serialize");
        assert_eq!(
            json,
            r#"{"kind":"pty_write_failed","reason":"broken pipe"}"#
        );
    }

    #[test]
    fn helper_constructors_round_trip() {
        let cases = [
            AppError::spawn("a"),
            AppError::write("b"),
            AppError::resize("c"),
            AppError::not_found("d"),
            AppError::internal("e"),
        ];
        for e in cases {
            let json = serde_json::to_string(&e).expect("serialize");
            assert!(json.contains("\"kind\":\""));
        }
    }
}
