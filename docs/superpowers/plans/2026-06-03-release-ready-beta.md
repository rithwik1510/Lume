# Release-Ready Public Beta Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Take Lume from "builds in dev only" to a downloadable, self-updating public beta — a tagged GitHub Release with a real Windows installer, an in-app auto-updater, and a one-command `npx lume` installer for the developer audience.

**Architecture:** Six sequenced phases. Phase 1 lands the in-flight work and the legal/metadata prerequisites (LICENSE, CHANGELOG, version bump). Phase 2 makes the app actually bundle into a Windows NSIS installer (it currently does not — `bundle.active` is `false`). Phase 3 wires the Tauri v2 updater + process plugins so beta testers self-update. Phase 4 adds a `tauri-action` release workflow triggered by a `v*` tag. Phase 5 builds and tests the standalone `npx lume` installer package. Phase 6 ships: push, tag, verify the artifacts, and publish the npm wrapper.

**Tech Stack:** Tauri v2 (NSIS bundler, `tauri-plugin-updater`, `tauri-plugin-process`), `tauri-apps/tauri-action` GitHub Action, React + Zustand front-end (existing `confirmStore`/`toastStore` reused for the update prompt), a standalone CommonJS Node package for the npm wrapper (tested with `node:test`, zero deps).

**Decisions locked (from the deep-dive):**
- Channels: **GitHub Releases (foundation) + `npx` wrapper.** No PowerShell one-liner, no winget/Scoop in this beta.
- Platform: **Windows only.** Unsigned NSIS `currentUser` installer (no admin). SmartScreen bypass documented in the README.
- Updater: **wired now** (Tauri updater + `latest.json` on Releases + a free Tauri signing keypair — this is the *update* signature, not a code-signing cert).

**Canonical facts (use these literal values — do not re-derive):**
- GitHub repo slug: `rithwik1510/Workflow`
- Releases page: `https://github.com/rithwik1510/Workflow/releases`
- Updater endpoint: `https://github.com/rithwik1510/Workflow/releases/latest/download/latest.json`
- Product name (NSIS output prefix): `Lume` → installer asset is `Lume_<version>_x64-setup.exe`
- Beta version: `0.1.0-beta.1`
- App identifier: `com.posan.lume`

**Verification gates (all five must be green at every commit):**
```bash
npm test -- --run
npm run typecheck
cargo test --lib --manifest-path src-tauri/Cargo.toml
cargo clippy --all-targets --manifest-path src-tauri/Cargo.toml -- -D warnings
cargo fmt --all --manifest-path src-tauri/Cargo.toml -- --check
```

**Phase commit targets:**
- `chore(release): land in-flight work, add LICENSE/CHANGELOG, bump to 0.1.0-beta.1`
- `feat(bundle): real icon set + enable Windows NSIS installer`
- `feat(updater): in-app auto-update via Tauri updater + process plugins`
- `ci(release): tauri-action release workflow on v* tag`
- `feat(npm): npx lume Windows installer package`
- `docs(release): install instructions + ship the beta`

---

## File structure delivered by this plan

### New files
| Path | Responsibility |
|---|---|
| `LICENSE` | MIT license text. |
| `CHANGELOG.md` | Keep-a-Changelog format; `0.1.0-beta.1` entry. |
| `RELEASING.md` | How to cut a release (bump → tag → push) + the required GitHub secrets. |
| `src/lib/versionConsistency.ts` | Pure helper: extract the version string from each manifest source. |
| `src/lib/versionConsistency.test.ts` | Vitest: asserts `package.json`, `tauri.conf.json`, `Cargo.toml` versions match. |
| `src/lib/updater.ts` | `checkForUpdatesOnLaunch()` — check, confirm, download+install, relaunch; failures degrade to a toast. |
| `.github/workflows/release.yml` | `tauri-action` build+release on a `v*` tag (Windows). |
| `npm/package.json` | The published `lume` wrapper package manifest. |
| `npm/bin/lume.js` | `npx lume` entry — fetch latest release, download the `-setup.exe`, launch it. |
| `npm/lib/resolveAsset.js` | Pure: pick the Windows installer asset URL from a GitHub release JSON. |
| `npm/lib/resolveAsset.test.js` | `node:test` coverage for the resolver. |
| `npm/README.md` | npm package readme (shown on the registry page). |
| `npm/.gitignore` | Ignore nothing build-related (no deps) — placeholder to keep the dir intentional. |

### Modified files
| Path | Change |
|---|---|
| `src-tauri/tauri.conf.json` | `bundle.active: true`, NSIS target + `installMode`, `createUpdaterArtifacts`, real icon list, Windows metadata, `plugins.updater` block; version bump. |
| `src-tauri/Cargo.toml` | `version` bump; add `license = "MIT"`; updater/process crates (via `tauri add`). |
| `src-tauri/src/lib.rs` | Register `tauri_plugin_updater` + `tauri_plugin_process` (via `tauri add`, then verify). |
| `src-tauri/capabilities/default.json` | Add `updater:default`, `process:default`. |
| `src-tauri/.gitignore` | Ignore the updater private key file. |
| `package.json` | `version` bump; add `@tauri-apps/plugin-updater`, `@tauri-apps/plugin-process`. |
| `src/App.tsx` | Call `checkForUpdatesOnLaunch()` once at boot in production builds. |
| `src-tauri/icons/` | Replace the 116-byte placeholder with a generated icon set. |
| `README.md` | Install/download section, SmartScreen + WebView2 notes, real License line, status → beta. |

---

## Process notes for the executing controller
- **One subagent per phase** where practical; Phases 5–6 may split. Each phase ends in one bundle commit + a holistic review.
- **Verification gates at every commit** (the five above). Phases that touch only the standalone `npm/` package also run `node --test npm/lib/`.
- **Phase 6 is interactive / network-bound** (pushing tags, watching CI, publishing to npm). Do not run those steps unattended — they create public artifacts. Confirm with the user before the `git push`, the tag push, and the `npm publish`.

---

# Phase 1 — Land in-flight work + legal/metadata prerequisites

**Why first:** You cannot tag a release on top of uncommitted, unverified work, and a *public* repo needs a license. This phase produces a clean, green, legally-publishable `main`.

## Task 1.1: Verify the working tree is green, then commit the Session Restore feature

**Files:**
- Commit (already in working tree): `src/lib/commandCapture.ts`, `src/lib/commandCapture.test.ts`, `src/store/layout/tree.ts`, `src/store/layout/tree.test.ts`, `src/store/sessionsStore.ts`, `src/store/sessionsStore.test.ts`, `src/terminals/orchestrator.ts`, `src/App.tsx`

- [ ] **Step 1: Run all five gates**

```bash
npm test -- --run
npm run typecheck
cargo test --lib --manifest-path src-tauri/Cargo.toml
cargo clippy --all-targets --manifest-path src-tauri/Cargo.toml -- -D warnings
cargo fmt --all --manifest-path src-tauri/Cargo.toml -- --check
```
Expected: all green. If any test fails, STOP — fix the Session Restore feature before continuing (it is the in-flight work; this plan assumes it is functionally complete, only uncommitted). Do not proceed to the release work over a red tree.

- [ ] **Step 2: Commit the feature**

```bash
git add src/lib/commandCapture.ts src/lib/commandCapture.test.ts src/store/layout/tree.ts src/store/layout/tree.test.ts src/store/sessionsStore.ts src/store/sessionsStore.test.ts src/terminals/orchestrator.ts src/App.tsx
git commit -m "$(cat <<'EOF'
feat(sessions): session restore — reopen last session + per-pane launch memory

Feature A: persist lastActiveSessionId + a reopenLastSession preference so a
routine relaunch revives the session the user last had open (cold start stays
all-stopped otherwise — activeSessionId is deliberately not persisted).

Feature B: each layout leaf remembers its shell and the first command typed
into it (commandCapture reconstructs it from the raw keystroke stream). On
revive the orchestrator respawns each pane with its real shell and PRE-FILLS
the remembered command at the prompt without a newline — the agent comes back
where you left it, but never silently starts a turn.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 1.2: Commit the website

**Files:**
- Commit: `website/` (its own `website/.gitignore` already excludes `node_modules`, `dist`, `.astro`)

- [ ] **Step 1: Confirm the website gitignore excludes build artifacts**

Read `website/.gitignore`. It must contain `node_modules`, `dist`, and `.astro`. If any is missing, add it:

```gitignore
node_modules
dist
.astro
```

- [ ] **Step 2: Stage and verify nothing huge is included**

```bash
git add website
git status --short website | grep -iE 'node_modules|/dist/|\.astro/' && echo "LEAK — fix gitignore" || echo "clean"
```
Expected: `clean` (no `node_modules`/`dist`/`.astro` paths staged).

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(website): Astro marketing landing page for Lume"
```

---

## Task 1.3: Add LICENSE (MIT) + license metadata

**Files:**
- Create: `LICENSE`
- Modify: `src-tauri/Cargo.toml`
- Modify: `README.md`

- [ ] **Step 1: Write `LICENSE`** (MIT — DESIGN.md §0 declares MIT)

```text
MIT License

Copyright (c) 2026 Posan

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

- [ ] **Step 2: Add the license field to `src-tauri/Cargo.toml`**

In the `[package]` block, add the `license` line right after `edition = "2021"`:

```toml
license = "MIT"
```

- [ ] **Step 3: Update the README License section**

In `README.md`, replace:
```markdown
## License

Not yet determined.
```
with:
```markdown
## License

MIT — see [`LICENSE`](./LICENSE).
```

- [ ] **Step 4: Verify Cargo still parses**

```bash
cargo metadata --no-deps --manifest-path src-tauri/Cargo.toml --format-version 1 > /dev/null && echo OK
```
Expected: `OK`.

- [ ] **Step 5: Commit (deferred — bundles with Phase 1)**

---

## Task 1.4: Add CHANGELOG.md

**Files:**
- Create: `CHANGELOG.md`

- [ ] **Step 1: Write `CHANGELOG.md`** (Keep a Changelog style)

```markdown
# Changelog

All notable changes to Lume are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); this project uses
[Semantic Versioning](https://semver.org/).

## [0.1.0-beta.1] — 2026-06-03

First public beta. Windows only.

### Added
- Smooth tiled terminal panes (xterm.js + WebGL) backed by real PTYs with
  32 ms batched IPC and an 8 MB per-pane ring buffer.
- Session manager sidebar — grouped sessions, rename, attention glow when a
  background agent goes quiet.
- Session restore — reopen the last session on launch and pre-fill each pane's
  remembered first command at the prompt (never auto-run).
- Markdown editor (CodeMirror 6 / view-mode render) + MD Quick Viewer.
- Localhost Preview panel — iframe a dev server beside your terminals.
- Drag a file from Explorer or the file drawer onto a terminal.
- Settings UI with theme + font-pair presets; hot-reloaded `config.toml`.
- Toasts, confirm dialogs, split menu, keyboard-shortcuts viewer.
- In-app auto-update (Tauri updater).

### Known limitations
- Windows only this beta; macOS/Linux later.
- Installer is unsigned — Windows SmartScreen shows a warning (see README).
- PTYs do not survive restart; sessions revive layout + pre-filled commands,
  not live processes.

[0.1.0-beta.1]: https://github.com/rithwik1510/Workflow/releases/tag/v0.1.0-beta.1
```

- [ ] **Step 2: Commit (deferred)**

---

## Task 1.5: Bump version to 0.1.0-beta.1 + add a version-consistency guard (TDD)

**Files:**
- Create: `src/lib/versionConsistency.ts`
- Create: `src/lib/versionConsistency.test.ts`
- Modify: `package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`

- [ ] **Step 1: Write the failing test**

```typescript
// src/lib/versionConsistency.test.ts
//
// Guards the classic "bumped two of three manifests" release bug. Reads the
// three sources of truth from disk and asserts they agree.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { extractVersions } from "@/lib/versionConsistency";

describe("version consistency", () => {
  it("package.json, tauri.conf.json and Cargo.toml share one version", () => {
    const root = resolve(__dirname, "../..");
    const pkg = readFileSync(resolve(root, "package.json"), "utf8");
    const conf = readFileSync(resolve(root, "src-tauri/tauri.conf.json"), "utf8");
    const cargo = readFileSync(resolve(root, "src-tauri/Cargo.toml"), "utf8");

    const { packageVersion, tauriVersion, cargoVersion } = extractVersions(pkg, conf, cargo);

    expect(tauriVersion).toBe(packageVersion);
    expect(cargoVersion).toBe(packageVersion);
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (module missing)

```bash
npm test -- --run src/lib/versionConsistency.test.ts
```
Expected: FAIL, "Cannot find module @/lib/versionConsistency".

- [ ] **Step 3: Implement the extractor**

```typescript
// src/lib/versionConsistency.ts
//
// Pure parsers for the three version sources. Kept text-in so the test can
// read the files and this stays trivially unit-testable. Cargo's version is
// the FIRST `version = "…"` under [package] — we read the first occurrence,
// which in this manifest is the package version.

export interface Versions {
  packageVersion: string;
  tauriVersion: string;
  cargoVersion: string;
}

export function extractVersions(
  packageJson: string,
  tauriConf: string,
  cargoToml: string
): Versions {
  const packageVersion = JSON.parse(packageJson).version as string;
  const tauriVersion = JSON.parse(tauriConf).version as string;
  const m = cargoToml.match(/^\s*version\s*=\s*"([^"]+)"/m);
  if (!m) throw new Error("no version found in Cargo.toml");
  return { packageVersion, tauriVersion, cargoVersion: m[1] };
}
```

- [ ] **Step 4: Bump all three manifests to `0.1.0-beta.1`**

`package.json`:
```json
  "version": "0.1.0-beta.1",
```
`src-tauri/tauri.conf.json`:
```json
  "version": "0.1.0-beta.1",
```
`src-tauri/Cargo.toml` (the `[package]` `version`):
```toml
version = "0.1.0-beta.1"
```

- [ ] **Step 5: Run — expect PASS**

```bash
npm test -- --run src/lib/versionConsistency.test.ts
```
Expected: green.

- [ ] **Step 6: Run all five gates, then commit the Phase 1 bundle**

```bash
npm test -- --run && npm run typecheck \
  && cargo test --lib --manifest-path src-tauri/Cargo.toml \
  && cargo clippy --all-targets --manifest-path src-tauri/Cargo.toml -- -D warnings \
  && cargo fmt --all --manifest-path src-tauri/Cargo.toml -- --check
git add LICENSE CHANGELOG.md README.md package.json src-tauri/Cargo.toml src-tauri/tauri.conf.json src/lib/versionConsistency.ts src/lib/versionConsistency.test.ts
git commit -m "$(cat <<'EOF'
chore(release): LICENSE + CHANGELOG + version-consistency guard, bump 0.1.0-beta.1

MIT LICENSE file and Cargo license field; CHANGELOG seeded with the beta entry;
a vitest guard that fails if package.json / tauri.conf.json / Cargo.toml drift
out of version sync. All three bumped to 0.1.0-beta.1.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Phase 1 — Holistic review
- [ ] Dispatch a reviewer over `git diff` of the phase: LICENSE present and referenced; CHANGELOG date is 2026-06-03; all three versions equal `0.1.0-beta.1`; website commit excluded build artifacts; Session Restore feature committed with its tests.

---

# Phase 2 — Bundle a real Windows installer

**Why this phase:** `bundle.active` is `false` and the icon is a 116-byte placeholder, so `tauri build` produces nothing shippable. This phase makes `npm run tauri build` emit `Lume_0.1.0-beta.1_x64-setup.exe`.

## Task 2.1: Generate a real icon set

**Files:**
- Replace: `src-tauri/icons/*`

- [ ] **Step 1: Obtain a 1024×1024 source PNG**

Use the brand mark. The website ships an SVG at `website/public/favicon.svg`. Produce a 1024×1024 PNG from it (any tool); save it as `src-tauri/icons/source-1024.png`. If no brand asset exists yet, create a simple amber-on-black "L" glyph at 1024×1024 — the icon can be refined later without changing the pipeline.

- [ ] **Step 2: Run the Tauri icon generator**

```bash
npm run tauri icon src-tauri/icons/source-1024.png
```
This regenerates `32x32.png`, `128x128.png`, `128x128@2x.png`, `icon.icns`, `icon.ico`, and the Windows Store `Square*Logo.png` / `StoreLogo.png` set under `src-tauri/icons/`.

- [ ] **Step 3: Verify the placeholder is gone**

```bash
python -c "import struct; d=open('src-tauri/icons/128x128.png','rb').read(); w,h=struct.unpack('>II',d[16:24]); print(w,h,len(d),'bytes')"
```
Expected: `128 128 <several KB>` — i.e. a real raster, not 116 bytes.

- [ ] **Step 4: Commit (deferred — bundles with Phase 2)**

---

## Task 2.2: Enable bundling + Windows NSIS config

**Files:**
- Modify: `src-tauri/tauri.conf.json`

- [ ] **Step 1: Replace the `bundle` block**

Replace the existing `bundle` object with:

```json
  "bundle": {
    "active": true,
    "targets": ["nsis"],
    "createUpdaterArtifacts": true,
    "publisher": "Posan",
    "category": "DeveloperTool",
    "shortDescription": "Smooth tiled terminals + markdown for AI coding agents",
    "longDescription": "Lume hosts multiple AI coding agents in parallel across smooth tiled terminal panes, with a markdown editor and a localhost preview — one workstation for agent-driven development.",
    "icon": [
      "icons/32x32.png",
      "icons/128x128.png",
      "icons/128x128@2x.png",
      "icons/icon.icns",
      "icons/icon.ico"
    ],
    "windows": {
      "nsis": {
        "installMode": "currentUser"
      }
    }
  }
```

> **Why these choices:** `nsis` only (not `msi`) avoids the WiX/VBScript build prerequisite and gives a single `.exe`. `installMode: currentUser` installs to `%LOCALAPPDATA%` with no admin prompt — the smoothest unsigned-beta path. `createUpdaterArtifacts: true` makes the bundler emit the `.sig` + updater bundle the Phase 3 updater needs.

- [ ] **Step 2: Build the installer locally**

```bash
npm run tauri build
```
Expected: completes and writes `src-tauri/target/release/bundle/nsis/Lume_0.1.0-beta.1_x64-setup.exe`. (First run downloads the NSIS toolchain; allow a few minutes.)

- [ ] **Step 3: Verify the artifact exists**

```bash
ls -la src-tauri/target/release/bundle/nsis/
```
Expected: a `Lume_0.1.0-beta.1_x64-setup.exe` file present.

- [ ] **Step 4: Smoke-test the install** (manual)

Run the produced `-setup.exe`. Expect: installs without an admin prompt, launches Lume, the app opens with a terminal pane. Uninstall via Windows "Apps" afterward to keep the dev machine clean.

- [ ] **Step 5: Run the five gates and commit the Phase 2 bundle**

```bash
npm test -- --run && npm run typecheck \
  && cargo test --lib --manifest-path src-tauri/Cargo.toml \
  && cargo clippy --all-targets --manifest-path src-tauri/Cargo.toml -- -D warnings \
  && cargo fmt --all --manifest-path src-tauri/Cargo.toml -- --check
git add src-tauri/icons src-tauri/tauri.conf.json
git commit -m "$(cat <<'EOF'
feat(bundle): real icon set + enable Windows NSIS installer

Replaces the 116-byte placeholder icon with a generated set and turns on
bundling (was bundle.active=false, so nothing shippable was ever produced).
Windows target is NSIS, currentUser install mode (no admin), with
createUpdaterArtifacts on for the auto-updater. Local build now emits
Lume_0.1.0-beta.1_x64-setup.exe.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Phase 2 — Holistic review
- [ ] Reviewer checks: `bundle.active` is true; only `nsis` target; icon array references generated files that exist; `createUpdaterArtifacts` present; the local build produced the `.exe`.

---

# Phase 3 — In-app auto-updater

**Why this phase:** Beta testers should get fixes without re-downloading. The Tauri updater checks a `latest.json` on the GitHub Release, downloads the signed NSIS update, installs, and relaunches.

## Task 3.1: Add the updater + process plugins

**Files:**
- Modify: `package.json`, `src-tauri/Cargo.toml`, `src-tauri/src/lib.rs`, `src-tauri/capabilities/default.json`

- [ ] **Step 1: Add both plugins via the Tauri CLI** (handles npm dep, Cargo dep, plugin registration, and capability)

```bash
npm run tauri add updater
npm run tauri add process
```

- [ ] **Step 2: Verify `src-tauri/src/lib.rs` registered them**

The `tauri::Builder` chain must now include (the CLI inserts these — confirm they are present; if not, add them next to the other `.plugin(...)` lines):

```rust
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
```

- [ ] **Step 3: Verify `src-tauri/capabilities/default.json` permissions**

The `permissions` array must include both (add any that the CLI did not):

```json
    "updater:default",
    "process:default"
```

- [ ] **Step 4: Verify the front-end packages installed**

```bash
node -e "require('@tauri-apps/plugin-updater/package.json'); require('@tauri-apps/plugin-process/package.json'); console.log('ok')"
```
Expected: `ok`.

- [ ] **Step 5: Rust gates**

```bash
cargo test --lib --manifest-path src-tauri/Cargo.toml \
  && cargo clippy --all-targets --manifest-path src-tauri/Cargo.toml -- -D warnings \
  && cargo fmt --all --manifest-path src-tauri/Cargo.toml -- --check
```
Expected: green.

- [ ] **Step 6: Commit (deferred — bundles with Phase 3)**

---

## Task 3.2: Generate the updater signing keypair + configure endpoints

**Files:**
- Create (NOT committed): `src-tauri/lume-updater.key` + `src-tauri/lume-updater.key.pub`
- Modify: `src-tauri/tauri.conf.json`, `src-tauri/.gitignore`

- [ ] **Step 1: Generate the keypair**

```bash
npm run tauri signer generate -- -w src-tauri/lume-updater.key
```
This prints a **public key** (a single base64 line) and writes the private key to `src-tauri/lume-updater.key`. Copy the printed public key for Step 3. When prompted for a password, set one and remember it (it becomes a GitHub secret in Phase 4).

- [ ] **Step 2: Gitignore the private key** — append to `src-tauri/.gitignore`:

```gitignore
# Updater signing key — never commit. Lives in GitHub Actions secrets for CI.
lume-updater.key
lume-updater.key.pub
```

> **Critical:** verify it is ignored before any commit: `git check-ignore src-tauri/lume-updater.key` must print the path. If the private key is ever committed, regenerate the keypair.

- [ ] **Step 3: Add the `plugins.updater` block to `src-tauri/tauri.conf.json`**

Add a top-level `plugins` key (sibling to `bundle`), pasting the public key from Step 1 in place of `PASTE_PUBLIC_KEY_HERE`:

```json
  "plugins": {
    "updater": {
      "pubkey": "PASTE_PUBLIC_KEY_HERE",
      "endpoints": [
        "https://github.com/rithwik1510/Workflow/releases/latest/download/latest.json"
      ]
    }
  }
```

> **Endpoint note:** `releases/latest/download/…` resolves to the newest **non-draft, non-prerelease** release. Phase 4 therefore publishes the beta as a normal (not prerelease, not draft) release so this URL resolves. Revisit if you later want prereleases on a separate channel.

- [ ] **Step 4: Typecheck the config by building** (catches malformed JSON / bad pubkey)

```bash
npm run tauri build -- --debug 2>&1 | tail -5
```
Expected: build proceeds past config parsing (a full debug build is fine; you can Ctrl-C once it starts compiling Rust if you only want the config validated).

- [ ] **Step 5: Commit (deferred — key files are gitignored, only the config changes commit)**

---

## Task 3.3: Update-check module + wire into boot

**Files:**
- Create: `src/lib/updater.ts`
- Modify: `src/App.tsx`

- [ ] **Step 1: Write `src/lib/updater.ts`**

```typescript
// src/lib/updater.ts
//
// In-app auto-update. Runs ONCE at boot in release builds. On finding an
// update it asks via the existing confirm dialog, then downloads, installs and
// relaunches. Any failure degrades to a warn toast — it never blocks startup.
// In dev there is no updater endpoint, so callers guard on import.meta.env.PROD.

import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

import { useConfirmStore } from "@/store/confirmStore";
import { useToastStore } from "@/store/toastStore";

export async function checkForUpdatesOnLaunch(): Promise<void> {
  try {
    const update = await check();
    if (!update) return;

    const ok = await useConfirmStore.getState().confirm({
      title: `Update available — ${update.version}`,
      message: `Lume ${update.version} is ready to install. Update now? The app will restart.`,
      confirmLabel: "Update & restart",
      cancelLabel: "Later",
    });
    if (!ok) return;

    useToastStore.getState().push({
      severity: "info",
      message: `Downloading update ${update.version}…`,
    });
    await update.downloadAndInstall();
    await relaunch();
  } catch (err) {
    useToastStore.getState().push({
      severity: "warn",
      message: `Update check failed: ${err instanceof Error ? err.message : String(err)}`,
    });
  }
}
```

- [ ] **Step 2: Call it once at boot in `src/App.tsx`**

In `App.tsx`, add the import near the other `@/lib` imports:

```tsx
import { checkForUpdatesOnLaunch } from "@/lib/updater";
```

Add a one-shot effect (empty deps) inside the `App` component, alongside the existing boot effects. Guard on `import.meta.env.PROD` so dev builds (no updater endpoint) stay quiet:

```tsx
  useEffect(() => {
    if (import.meta.env.PROD) {
      void checkForUpdatesOnLaunch();
    }
  }, []);
```

> **Implementer note:** if `App.tsx` already has a single boot `useEffect`, add the guarded call at its end instead of creating a second effect — keep one boot effect if that matches the existing structure.

- [ ] **Step 3: Typecheck**

```bash
npm run typecheck
```
Expected: clean.

- [ ] **Step 4: Run the five gates and commit the Phase 3 bundle**

```bash
npm test -- --run && npm run typecheck \
  && cargo test --lib --manifest-path src-tauri/Cargo.toml \
  && cargo clippy --all-targets --manifest-path src-tauri/Cargo.toml -- -D warnings \
  && cargo fmt --all --manifest-path src-tauri/Cargo.toml -- --check
git add package.json package-lock.json src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/lib.rs src-tauri/capabilities/default.json src-tauri/tauri.conf.json src-tauri/.gitignore src/lib/updater.ts src/App.tsx
git commit -m "$(cat <<'EOF'
feat(updater): in-app auto-update via Tauri updater + process plugins

Adds tauri-plugin-updater + tauri-plugin-process. checkForUpdatesOnLaunch()
runs once at boot in release builds: check() -> confirm dialog -> download +
install -> relaunch, with failures degraded to a warn toast so startup never
blocks. Updater endpoint points at the GitHub Release latest.json; the signing
public key is in tauri.conf.json, the private key is gitignored and lives in CI
secrets.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Phase 3 — Holistic review
- [ ] Reviewer checks: private key is gitignored (`git check-ignore` passes) and NOT in the diff; pubkey + endpoint present; update prompt reuses `confirmStore`; the boot call is guarded on `import.meta.env.PROD`; capability has `updater:default` + `process:default`.

---

# Phase 4 — Release CI (tauri-action on a version tag)

**Why this phase:** Pushing a `v*` tag should build the installer, sign the updater artifacts, create the GitHub Release, and upload `latest.json` — all unattended.

## Task 4.1: Write the release workflow

**Files:**
- Create: `.github/workflows/release.yml`

- [ ] **Step 1: Write `.github/workflows/release.yml`**

```yaml
# Release pipeline — builds the Windows installer and publishes a GitHub
# Release when a v* tag is pushed. tauri-action also signs the updater
# artifacts and uploads latest.json (uploadUpdaterJson defaults to true) so the
# in-app updater can find new versions.
name: release

on:
  push:
    tags:
      - "v*"
  workflow_dispatch:

permissions:
  contents: write

jobs:
  release:
    name: release (windows-latest)
    runs-on: windows-latest

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node 20
        uses: actions/setup-node@v4
        with:
          node-version: "20"
          cache: "npm"

      - name: Setup Rust stable
        uses: dtolnay/rust-toolchain@stable

      - name: Rust cache
        uses: swatinem/rust-cache@v2
        with:
          workspaces: "src-tauri -> target"

      - name: Install npm dependencies
        run: npm ci

      - name: Build + release
        uses: tauri-apps/tauri-action@v0
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}
          TAURI_SIGNING_PRIVATE_KEY_PASSWORD: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY_PASSWORD }}
        with:
          tagName: ${{ github.ref_name }}
          releaseName: "Lume ${{ github.ref_name }}"
          releaseBody: "See CHANGELOG.md. Windows installer is unsigned — if SmartScreen appears, click More info then Run anyway."
          releaseDraft: false
          prerelease: false
```

> **Why `prerelease: false` / `releaseDraft: false`:** the updater endpoint `releases/latest/download/latest.json` only resolves to a published, non-prerelease release (Phase 3 note). For a first beta that is also the latest release, this is correct.

- [ ] **Step 2: Validate the YAML**

```bash
node -e "const fs=require('fs');const s=fs.readFileSync('.github/workflows/release.yml','utf8');if(!s.includes('tauri-apps/tauri-action'))throw new Error('missing action');console.log('ok')"
```
Expected: `ok`. (Optionally run `actionlint` if available.)

- [ ] **Step 3: Commit (deferred — bundles with Phase 4)**

---

## Task 4.2: Document the release process + required secrets

**Files:**
- Create: `RELEASING.md`

- [ ] **Step 1: Write `RELEASING.md`**

```markdown
# Releasing Lume

## One-time setup — GitHub repository secrets

Set these under **Settings → Secrets and variables → Actions** in
`rithwik1510/Workflow`:

| Secret | Value |
|---|---|
| `TAURI_SIGNING_PRIVATE_KEY` | The full contents of `src-tauri/lume-updater.key` (the private key file generated by `tauri signer generate`). |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | The password you set when generating the key. |

`GITHUB_TOKEN` is provided automatically by Actions — no setup needed.

## Cutting a release

1. Update `CHANGELOG.md` with the new version's notes.
2. Bump the version in **all three** manifests to the same value
   (`package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`). The
   `versionConsistency` vitest fails if they drift.
3. Commit: `git commit -am "chore(release): vX.Y.Z"`.
4. Tag and push:
   ```bash
   git tag vX.Y.Z
   git push origin main --tags
   ```
5. The `release` workflow builds the Windows installer, signs the updater
   artifacts, and publishes a GitHub Release with `latest.json` attached.
6. Verify the Release page shows `Lume_X.Y.Z_x64-setup.exe`, its `.sig`, and
   `latest.json`.

## Versioning

- Betas: `0.1.0-beta.N`.
- The tag (`vX.Y.Z`) drives the release name; the installer version comes from
  `tauri.conf.json`. Keep the tag and the manifests in sync.
```

- [ ] **Step 2: Commit the Phase 4 bundle**

```bash
git add .github/workflows/release.yml RELEASING.md
git commit -m "$(cat <<'EOF'
ci(release): tauri-action release workflow on v* tag

Pushing a vX.Y.Z tag builds the Windows NSIS installer on windows-latest, signs
the updater artifacts with the CI signing key, and publishes a GitHub Release
with latest.json so the in-app updater can find it. RELEASING.md documents the
required secrets and the bump -> tag -> push flow.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Phase 4 — Holistic review
- [ ] Reviewer checks: trigger is `v*` tags; `permissions: contents: write`; signing env vars wired; `prerelease`/`releaseDraft` false; RELEASING.md names the exact secrets.

---

# Phase 5 — `npx lume` installer package

**Why this phase:** The headline channel for the developer audience. `npx lume` fetches the latest installer from the GitHub Release and launches it — no manual download. Standalone package under `npm/`, zero runtime deps, tested with Node's built-in test runner.

## Task 5.1: Check the npm package name + scaffold the package

**Files:**
- Create: `npm/package.json`, `npm/.gitignore`

- [ ] **Step 1: Check name availability**

```bash
npm view lume version 2>&1 | head -2
```
- If it prints `npm error 404` (or "is not in this registry") → the name `lume` is free; use `lume`.
- If it returns a version → the name is taken; use `lume-desktop` instead and substitute `lume-desktop` for `lume` everywhere in this phase and in the README install command.

- [ ] **Step 2: Write `npm/package.json`** (use the name resolved in Step 1)

```json
{
  "name": "lume",
  "version": "0.1.0-beta.1",
  "description": "Installer for Lume — smooth tiled terminals + markdown editor for running AI coding agents (Windows beta).",
  "bin": {
    "lume": "bin/lume.js"
  },
  "files": [
    "bin/",
    "lib/",
    "README.md"
  ],
  "repository": {
    "type": "git",
    "url": "git+https://github.com/rithwik1510/Workflow.git"
  },
  "license": "MIT",
  "engines": {
    "node": ">=18"
  }
}
```

- [ ] **Step 3: Write `npm/.gitignore`**

```gitignore
# This package has no build step and no deps; nothing to ignore yet.
# Present so the directory's intent is explicit.
node_modules
```

- [ ] **Step 4: Commit (deferred — bundles with Phase 5)**

---

## Task 5.2: Asset resolver (pure, TDD)

**Files:**
- Create: `npm/lib/resolveAsset.js`
- Create: `npm/lib/resolveAsset.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
// npm/lib/resolveAsset.test.js
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { pickWindowsSetupUrl } = require("./resolveAsset.js");

test("finds the -setup.exe asset", () => {
  const release = {
    assets: [
      { name: "Lume_0.1.0-beta.1_x64-setup.exe", browser_download_url: "https://x/setup.exe" },
      { name: "latest.json", browser_download_url: "https://x/latest.json" },
    ],
  };
  assert.equal(pickWindowsSetupUrl(release), "https://x/setup.exe");
});

test("ignores msi / sig / json and returns null when no installer", () => {
  const release = {
    assets: [
      { name: "Lume_0.1.0-beta.1_x64_en-US.msi", browser_download_url: "https://x/m.msi" },
      { name: "Lume_0.1.0-beta.1_x64-setup.exe.sig", browser_download_url: "https://x/s.sig" },
    ],
  };
  assert.equal(pickWindowsSetupUrl(release), null);
});

test("returns null for empty / missing assets", () => {
  assert.equal(pickWindowsSetupUrl({}), null);
  assert.equal(pickWindowsSetupUrl({ assets: [] }), null);
  assert.equal(pickWindowsSetupUrl(null), null);
});
```

- [ ] **Step 2: Run — expect FAIL** (module missing)

```bash
node --test npm/lib/
```
Expected: FAIL, cannot find `./resolveAsset.js`.

- [ ] **Step 3: Implement**

```javascript
// npm/lib/resolveAsset.js
"use strict";
// Pure helper: from a GitHub "latest release" API response, return the
// browser_download_url of the Windows NSIS installer (name ends with
// "-setup.exe"), or null. No network here so it is trivially unit-testable.

function pickWindowsSetupUrl(release) {
  const assets = (release && release.assets) || [];
  const asset = assets.find((a) => /-setup\.exe$/i.test(a.name));
  return asset ? asset.browser_download_url : null;
}

module.exports = { pickWindowsSetupUrl };
```

- [ ] **Step 4: Run — expect PASS**

```bash
node --test npm/lib/
```
Expected: 3 tests pass.

- [ ] **Step 5: Commit (deferred)**

---

## Task 5.3: The `lume` bin — fetch, download, launch

**Files:**
- Create: `npm/bin/lume.js`

- [ ] **Step 1: Write `npm/bin/lume.js`**

```javascript
#!/usr/bin/env node
"use strict";
// `npx lume` — download the latest Lume Windows installer from the GitHub
// Release and launch it. Windows-only for the beta; other platforms get a
// pointer to the releases page. Zero dependencies (Node >= 18 global fetch).

const os = require("os");
const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");
const { pickWindowsSetupUrl } = require("../lib/resolveAsset.js");

const REPO = "rithwik1510/Workflow";
const RELEASES_PAGE = `https://github.com/${REPO}/releases`;
const API_LATEST = `https://api.github.com/repos/${REPO}/releases/latest`;

async function main() {
  if (process.platform !== "win32") {
    console.log(`Lume's beta is Windows-only for now.\nDownloads: ${RELEASES_PAGE}`);
    return;
  }

  console.log("Fetching the latest Lume release…");
  const res = await fetch(API_LATEST, {
    headers: {
      "User-Agent": "lume-installer",
      Accept: "application/vnd.github+json",
    },
  });
  if (!res.ok) {
    throw new Error(`GitHub API responded ${res.status}. Download manually: ${RELEASES_PAGE}`);
  }
  const release = await res.json();
  const url = pickWindowsSetupUrl(release);
  if (!url) {
    throw new Error(`No Windows installer found in the latest release. See ${RELEASES_PAGE}`);
  }

  const dest = path.join(os.tmpdir(), `Lume-setup-${process.pid}.exe`);
  console.log("Downloading installer…");
  const dl = await fetch(url, { headers: { "User-Agent": "lume-installer" } });
  if (!dl.ok) throw new Error(`Download failed: HTTP ${dl.status}`);
  fs.writeFileSync(dest, Buffer.from(await dl.arrayBuffer()));

  console.log("Launching the installer…");
  const child = spawn(dest, [], { detached: true, stdio: "ignore" });
  child.unref();
  console.log(
    "Installer launched. If Windows SmartScreen appears, click 'More info' then 'Run anyway'."
  );
}

main().catch((err) => {
  console.error(`\nCouldn't install Lume automatically: ${err.message}`);
  console.error(`Download it directly: ${RELEASES_PAGE}`);
  process.exit(1);
});
```

- [ ] **Step 2: Sanity-check the non-Windows guard runs without throwing** (on any platform, the resolver + module load must be clean)

```bash
node -e "require('./npm/bin/lume.js')" 2>&1 | head -3
```
Expected: on Windows it begins "Fetching the latest Lume release…" (and will only succeed end-to-end after a release exists — full smoke is Phase 6). On non-Windows it prints the Windows-only message and exits 0. No syntax/require errors either way.

- [ ] **Step 3: Write `npm/README.md`**

```markdown
# lume

One-command installer for [Lume](https://github.com/rithwik1510/Workflow) —
smooth tiled terminals + a markdown editor for running AI coding agents.

## Install (Windows)

```bash
npx lume
```

This downloads the latest signed installer from GitHub Releases and launches
it. The beta installer is unsigned, so Windows SmartScreen may warn — click
**More info → Run anyway**.

Prefer a direct download? Grab the `.exe` from the
[Releases page](https://github.com/rithwik1510/Workflow/releases).

macOS and Linux are not in the beta yet.
```

- [ ] **Step 4: Run the package tests once more, then commit the Phase 5 bundle**

```bash
node --test npm/lib/
git add npm/
git commit -m "$(cat <<'EOF'
feat(npm): npx lume Windows installer package

A standalone, zero-dependency package: `npx lume` queries the latest GitHub
Release, picks the -setup.exe asset, downloads it to the temp dir, and launches
the installer. Non-Windows prints a pointer to the releases page. The asset
resolver is pure and covered by node:test.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Phase 5 — Holistic review
- [ ] Reviewer checks: bin has the shebang + `bin` mapping in package.json; resolver excludes `.msi`/`.sig`/`.json`; download lands in `os.tmpdir()`; failures point users at the releases page; `files` whitelist ships only `bin/`, `lib/`, `README.md`; package name matches what Task 5.1 resolved.

---

# Phase 6 — Ship the beta (interactive / network)

**Why last:** these steps publish public artifacts. Run them with the user present; confirm before each push and the npm publish.

## Task 6.1: README install/download section

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update the status line** at the top of `README.md`:

```markdown
**Status:** v0.1.0-beta.1 — public Windows beta.
```

- [ ] **Step 2: Add an Install section** directly under the intro (before "What this is"):

```markdown
## Install (Windows)

**Easiest — one command** (needs Node 18+):

```bash
npx lume
```

**Direct download:** grab `Lume_<version>_x64-setup.exe` from the
[Releases page](https://github.com/rithwik1510/Workflow/releases) and run it.

The installer is **unsigned** during the beta, so Windows SmartScreen shows
"Windows protected your PC." Click **More info → Run anyway**. It installs to
your user profile (no admin needed) and auto-updates itself from then on.

Windows 11 ships the WebView2 runtime Lume needs. On older Windows 10 machines
without it, install the
[Evergreen WebView2 Runtime](https://developer.microsoft.com/microsoft-edge/webview2/)
first.

macOS and Linux are not in the beta yet.
```

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs(release): install instructions, SmartScreen + WebView2 notes, beta status"
```

---

## Task 6.2: Push main

- [ ] **Step 1: Confirm the tree is green and clean**

```bash
npm test -- --run && npm run typecheck \
  && cargo test --lib --manifest-path src-tauri/Cargo.toml \
  && cargo clippy --all-targets --manifest-path src-tauri/Cargo.toml -- -D warnings \
  && cargo fmt --all --manifest-path src-tauri/Cargo.toml -- --check
git status --short
```
Expected: gates green, working tree clean (only `Github Pushes Left.md` may remain untracked — it is a scratch doc; leave it or delete it, your call).

- [ ] **Step 2: Push** (CONFIRM with the user first — this publishes ~90 commits)

```bash
git push origin main
```

- [ ] **Step 3: Verify the `ci` workflow passes on GitHub** for the pushed `main`.

---

## Task 6.3: Set secrets, tag, and release

- [ ] **Step 1: Set the two GitHub secrets** per `RELEASING.md` (Settings → Secrets and variables → Actions):
  - `TAURI_SIGNING_PRIVATE_KEY` = contents of `src-tauri/lume-updater.key`
  - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` = the key password

  Set them via the GitHub UI, or:
  ```bash
  gh secret set TAURI_SIGNING_PRIVATE_KEY < src-tauri/lume-updater.key
  gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD
  ```

- [ ] **Step 2: Tag and push** (CONFIRM with the user — this triggers a public release build)

```bash
git tag v0.1.0-beta.1
git push origin v0.1.0-beta.1
```

- [ ] **Step 3: Watch the `release` workflow** until it completes:

```bash
gh run watch
```

- [ ] **Step 4: Verify the Release** at `https://github.com/rithwik1510/Workflow/releases/tag/v0.1.0-beta.1` shows all three artifacts:
  - `Lume_0.1.0-beta.1_x64-setup.exe`
  - `Lume_0.1.0-beta.1_x64-setup.exe.sig`
  - `latest.json`

  And that `latest.json` resolves: `curl -sSL https://github.com/rithwik1510/Workflow/releases/latest/download/latest.json | head` returns JSON with `version` and a `platforms` map.

---

## Task 6.4: Publish the npm wrapper + smoke test

- [ ] **Step 1: Publish** (CONFIRM with the user — `npm login` first if needed)

```bash
cd npm
npm publish --access public
cd ..
```

- [ ] **Step 2: Smoke-test the real install on a clean Windows shell**

```bash
npx --yes lume@latest
```
Expected: prints "Fetching the latest Lume release…", downloads, launches the installer. Complete the install, confirm Lume launches.

- [ ] **Step 3: Smoke-test auto-update** (manual, optional but recommended)

To prove the updater end-to-end: bump to `0.1.0-beta.2`, tag, let CI publish, then launch the installed `0.1.0-beta.1` — it should prompt "Update available — 0.1.0-beta.2", install, and relaunch. (Skip if you'd rather validate on the next real fix.)

---

## Task 6.5: Final verification checklist

- [ ] GitHub Release `v0.1.0-beta.1` is public, not draft, not prerelease, with the `.exe` + `.sig` + `latest.json`.
- [ ] `npx lume` installs Lume on a clean Windows machine.
- [ ] Installed app launches, opens a terminal pane, and session restore works.
- [ ] `latest.json` URL resolves (updater endpoint live).
- [ ] README install instructions match reality (command name, SmartScreen steps).
- [ ] The updater private key is NOT in the repo (`git log -p -- src-tauri/lume-updater.key` is empty).
- [ ] CHANGELOG, LICENSE, RELEASING.md all present on `main`.

---

## Self-Review (run before handing off)

**Spec coverage vs. the deep-dive's 8 loop-closers:**
1. Finish + commit Session Restore WIP → Task 1.1 ✓
2. Real icon → Task 2.1 ✓
3. Enable bundling (NSIS currentUser) → Task 2.2 ✓
4. LICENSE + CHANGELOG → Tasks 1.3, 1.4 ✓
5. Release workflow (tauri-action on tag) → Task 4.1 ✓
6. README install + SmartScreen note → Tasks 6.1 ✓
7. Tauri updater wired → Phase 3 ✓
8. Bump to beta + tag + push → Tasks 1.5, 6.2, 6.3 ✓

**Locked-decision coverage:** GitHub Releases (Phase 4) + npx wrapper (Phase 5) ✓; Windows-only (NSIS target, bin platform guard) ✓; updater wired now (Phase 3) ✓. No PowerShell one-liner, no winget/Scoop, no mac/linux — correctly absent.

**Placeholder scan:** the only "paste this" values are the generated updater public key (Task 3.2 Step 3) and the npm package name fallback (Task 5.1) — both are runtime-resolved with explicit instructions, not unspecified TODOs. All file paths and URLs are literal.

**Type/name consistency:** `pickWindowsSetupUrl` (resolver + bin + tests), `checkForUpdatesOnLaunch` (updater + App), `extractVersions` (helper + test), repo slug `rithwik1510/Workflow`, version `0.1.0-beta.1`, asset name `Lume_0.1.0-beta.1_x64-setup.exe` — all referenced consistently across phases.
