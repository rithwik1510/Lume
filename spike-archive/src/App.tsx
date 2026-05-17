import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { Channel, invoke } from "@tauri-apps/api/core";
import "@xterm/xterm/css/xterm.css";

// PTY bytes flow: Rust portable-pty -> Channel<Vec<u8>> -> term.write(bytes).
// PTY bytes NEVER touch React state. Per DESIGN.md §4 mandatory data-flow rule.
type PtyEvent =
  | { kind: "data"; bytes: number[] }
  | { kind: "exit"; code: number | null };

export default function App() {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);

  useEffect(() => {
    if (!hostRef.current) return;

    const term = new Terminal({
      fontFamily: '"JetBrains Mono", Consolas, "Courier New", monospace',
      fontSize: 14,
      lineHeight: 1.2,
      cursorBlink: true,
      cursorStyle: "block",
      theme: {
        background: "#0a0a0a",
        foreground: "#e8e8e8",
        cursor: "#d4a85c",
        selectionBackground: "#d4a85c33",
      },
      scrollback: 10000,
      allowProposedApi: true,
    });
    termRef.current = term;

    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(hostRef.current);

    // WebGL renderer is the whole point of the spike. If this throws, we know.
    try {
      const webgl = new WebglAddon();
      webgl.onContextLoss(() => webgl.dispose());
      term.loadAddon(webgl);
      term.write("\x1b[33m[webgl renderer active]\x1b[0m\r\n");
    } catch (e) {
      term.write(`\x1b[31m[webgl failed: ${String(e)}]\x1b[0m\r\n`);
    }

    fit.fit();

    // Mouse-mode panic key: Ctrl+Shift+R disables every mouse-tracking mode
    // a previous app might have left enabled (e.g. top killed with SIGTERM).
    // Lives outside xterm's key handler so it works even when the PTY is mid-flood.
    const resetMouseModes = () => {
      term.write(
        "\x1b[?9l\x1b[?1000l\x1b[?1001l\x1b[?1002l\x1b[?1003l\x1b[?1004l\x1b[?1005l\x1b[?1006l\x1b[?1015l\x1b[?1016l"
      );
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && (e.key === "R" || e.key === "r")) {
        e.preventDefault();
        resetMouseModes();
        term.write("\r\n\x1b[33m[mouse modes reset]\x1b[0m\r\n");
      }
    };
    window.addEventListener("keydown", onKey, true);
    // Defensive: clear mouse modes proactively on mount — covers cases where
    // a previous PTY left them on and the React tree remounted.
    resetMouseModes();

    // Wire PTY via Channel<Vec<u8>>. NOT emit() — emit JSON-serializes payloads.
    const channel = new Channel<PtyEvent>();
    channel.onmessage = (evt) => {
      if (evt.kind === "data") {
        // Convert number[] back to Uint8Array for xterm.
        term.write(new Uint8Array(evt.bytes));
      } else if (evt.kind === "exit") {
        term.write(`\r\n\x1b[31m[pty exited code=${evt.code}]\x1b[0m\r\n`);
      }
    };

    // Pipe keystrokes back to PTY.
    term.onData((data) => {
      invoke("pty_write", { data }).catch((e) =>
        term.write(`\r\n\x1b[31m[pty_write failed: ${String(e)}]\x1b[0m\r\n`)
      );
    });

    // Resize PTY when the window resizes.
    const onResize = () => {
      fit.fit();
      invoke("pty_resize", { cols: term.cols, rows: term.rows }).catch(() => {});
    };
    window.addEventListener("resize", onResize);

    // Kick it off — spawn WSL Ubuntu.
    invoke("pty_open", {
      channel,
      cols: term.cols,
      rows: term.rows,
    }).catch((e) => {
      term.write(`\r\n\x1b[31m[pty_open failed: ${String(e)}]\x1b[0m\r\n`);
    });

    term.focus();

    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("keydown", onKey, true);
      term.dispose();
      termRef.current = null;
      // Don't invoke pty_kill here — Tauri tears down the process on window close
      // anyway, and the cleanup race during HMR was nuking healthy PTY state.
    };
  }, []);

  return (
    <div
      style={{
        width: "100vw",
        height: "100vh",
        padding: 8,
        boxSizing: "border-box",
        background: "#0a0a0a",
      }}
    >
      <div ref={hostRef} style={{ width: "100%", height: "100%" }} />
    </div>
  );
}
