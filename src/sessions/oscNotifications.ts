// OSC notification handlers. See spec §10.2.
//
// xterm.js's `parser.registerOscHandler(N, cb)` returns an IDisposable. The
// handler receives the OSC string contents and returns a boolean: true =
// "handled, don't pass through", false = "let other handlers run". We return
// true to absorb the sequence — OSC 9 / 99 / 777 are notification conventions
// (iTerm2 / KDE / rxvt respectively), NOT the window-title sequences (OSC 0 /
// 1 / 2), so absorbing them here doesn't suppress any title updates.
//
// When any of these fire, we bump the `unread` flag on the session that owns
// the emitting pane. bumpUnread is a no-op when that session is the active
// one (you don't get an unread badge for the session you're looking at).

import type { Terminal } from "@xterm/xterm";
import { findSessionForPane, useSessionsStore } from "@/store/sessionsStore";
import type { PaneId } from "@/types";

const OSC_CODES = [9, 99, 777] as const;

/** Register OSC notification handlers on a Terminal. Returns a disposer. */
export function registerOscHandlers(paneId: PaneId, term: Terminal): () => void {
  const disposers = OSC_CODES.map((code) =>
    term.parser.registerOscHandler(code, (_data: string) => {
      const session = findSessionForPane(useSessionsStore.getState(), paneId);
      if (session) {
        useSessionsStore.getState().bumpUnread(session.id);
      }
      // Absorb the sequence — don't propagate to any default handler.
      return true;
    })
  );
  return () => {
    for (const d of disposers) d.dispose();
  };
}
