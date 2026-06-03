// src/lib/pasteFileToPane.ts
//
// The one primitive both drag sources call. Resolves the pane's owning session
// folder, formats the path (attachPath), and routes it through the terminal's
// paste() — which goes onData → PTY with bracketed-paste handling (registry.ts).
// No trailing newline: the path lands at the prompt and the user keeps typing.

import { formatAttachPath } from "@/lib/attachPath";
import { getOrCreateTerminal, focusTerminal } from "@/terminals/registry";
import { useLayoutStore } from "@/store/layoutStore";
import { useSessionsStore, findSessionForPane } from "@/store/sessionsStore";
import type { PaneId } from "@/types";

export function pasteFileToPane(paneId: PaneId, filePath: string): void {
  const session = findSessionForPane(useSessionsStore.getState(), paneId);
  const folder = session?.folderPath ?? null;
  const text = formatAttachPath(filePath, folder);
  getOrCreateTerminal(paneId).paste(text);
  useLayoutStore.getState().focusPane(paneId);
  focusTerminal(paneId);
}
