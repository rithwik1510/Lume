// Regression guard for the "MD editor is blank in the packaged app" bug.
//
// CodeMirror styles itself entirely by injecting runtime <style> elements
// (via style-mod). In a production Tauri build, Tauri's default CSP handling
// adds a `'nonce-…'` to `style-src`; per the CSP3 spec, the presence of a
// nonce makes the browser IGNORE `'unsafe-inline'`, so CodeMirror's nonce-less
// injected styles get blocked (`style-src-elem blocked=inline`). The editor
// then renders with zero theme/layout — a blank, uneditable pane. (The
// markdown VIEWER is unaffected because it uses bundled CSS via <link>.)
//
// The fix: tell Tauri NOT to nonce-modify `style-src`, leaving our intended
// `style-src 'self' 'unsafe-inline'` effective. script-src keeps its nonce.
// If this setting is ever removed, the editor breaks again in the packaged
// app (but NOT in dev or unit tests — only a real production build catches
// it), so this test pins it down.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("tauri CSP config", () => {
  it("disables style-src nonce modification so CodeMirror's injected styles survive", () => {
    const conf = JSON.parse(
      readFileSync(resolve(__dirname, "../../src-tauri/tauri.conf.json"), "utf8")
    );
    const disabled = conf?.app?.security?.dangerousDisableAssetCspModification;
    expect(
      Array.isArray(disabled) && disabled.includes("style-src"),
      "tauri.conf.json app.security.dangerousDisableAssetCspModification must include \"style-src\" — see this file's header comment"
    ).toBe(true);

    // Sanity: style-src must still allow inline styles for the above to matter.
    expect(conf.app.security.csp).toContain("style-src");
    expect(conf.app.security.csp).toContain("'unsafe-inline'");
  });
});
