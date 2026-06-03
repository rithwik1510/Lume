// applySettings — bridges settingsStore → live xterm Terminals. The mapper is
// pure (unit-tested); installSettingsApply wires it to store changes at boot.

import type { ITerminalOptions } from "@xterm/xterm";
import { useSettingsStore } from "@/store/settingsStore";
import { applyOptionsToAll } from "@/terminals/registry";
import type { LumeConfig } from "@/types/config";

/** The subset of xterm options the Settings panel controls. */
export function terminalOptionsFromConfig(cfg: LumeConfig): Partial<ITerminalOptions> {
  return {
    fontSize: cfg.font.size,
    fontWeight: String(cfg.font.weight) as ITerminalOptions["fontWeight"],
    lineHeight: cfg.font.line_height,
    cursorStyle: cfg.terminal.cursor_style,
    cursorBlink: cfg.terminal.cursor_blink,
    scrollback: cfg.terminal.scrollback_lines,
  };
}

/** Subscribe to settingsStore and push terminal-affecting options to all live
 *  Terminals whenever they change. Returns an unsubscribe fn. Call once at boot. */
export function installSettingsApply(): () => void {
  let prev = terminalOptionsFromConfig(useSettingsStore.getState().config);
  applyOptionsToAll(prev);
  return useSettingsStore.subscribe((state) => {
    const next = terminalOptionsFromConfig(state.config);
    const changed = (Object.keys(next) as (keyof typeof next)[]).some((k) => next[k] !== prev[k]);
    if (!changed) return;
    prev = next;
    applyOptionsToAll(next);
  });
}
