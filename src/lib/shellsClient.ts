// shellsClient — thin wrapper over the Rust `detect_shells` command + a
// label helper for rendering Shell variants in menus. The Rust side returns
// a serde-tagged discriminated union that aligns 1:1 with the TS `Shell`
// type in `@/types` (DESIGN.md §12 W3 #8).

import { invoke } from "@tauri-apps/api/core";
import type { Shell } from "@/types";

export function detectShells(): Promise<Shell[]> {
  return invoke<Shell[]>("detect_shells");
}

export function shellLabel(s: Shell): string {
  switch (s.kind) {
    case "pwsh":
      return "PowerShell 7 (pwsh)";
    case "powershell":
      return "Windows PowerShell (5.1)";
    case "cmd":
      return "Command Prompt (cmd)";
    case "wsl":
      return `WSL · ${s.distro}`;
  }
}
