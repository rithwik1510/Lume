#!/usr/bin/env node
"use strict";
// `npx lume-desktop` — download the latest Lume Windows installer from the GitHub
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
