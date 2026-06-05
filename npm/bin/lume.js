#!/usr/bin/env node
"use strict";
// `npx lume-desktop` — download the latest Lume Windows installer from the GitHub
// Release and launch it. Windows-only for the beta; other platforms get a
// pointer to the releases page. Zero dependencies (Node >= 18 global fetch).

const os = require("os");
const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");
const { pickWindowsSetup, isTrustedHost } = require("../lib/resolveAsset.js");
const { verifyMinisign } = require("../lib/verifyMinisign.js");

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

  const setup = pickWindowsSetup(release);
  if (!setup) throw new Error(`No Windows installer in the latest release. See ${RELEASES_PAGE}`);
  if (!setup.sigUrl) throw new Error(`Release is missing the signature (.sig); refusing to install. ${RELEASES_PAGE}`);
  if (!isTrustedHost(setup.exeUrl) || !isTrustedHost(setup.sigUrl)) {
    throw new Error(`Download URL is not a trusted GitHub host; aborting. ${RELEASES_PAGE}`);
  }

  console.log("Downloading installer…");
  const exeRes = await fetch(setup.exeUrl, { headers: { "User-Agent": "lume-installer" } });
  if (!exeRes.ok) throw new Error(`Download failed: HTTP ${exeRes.status}`);
  const exeBytes = Buffer.from(await exeRes.arrayBuffer());

  const sigRes = await fetch(setup.sigUrl, { headers: { "User-Agent": "lume-installer" } });
  if (!sigRes.ok) throw new Error(`Signature download failed: HTTP ${sigRes.status}`);
  const sigText = await sigRes.text();

  console.log("Verifying signature…");
  if (!verifyMinisign(exeBytes, sigText)) {
    throw new Error(`Signature verification FAILED — the installer is not authentic. Aborting. ${RELEASES_PAGE}`);
  }

  const dest = path.join(os.tmpdir(), `Lume-setup-${process.pid}.exe`);
  fs.writeFileSync(dest, exeBytes);
  console.log("Launching the installer…");
  const child = spawn(dest, [], { detached: true, stdio: "ignore" });
  child.unref();
  console.log("Installer launched. If Windows SmartScreen appears, click 'More info' then 'Run anyway'.");
}

main().catch((err) => {
  console.error(`\nCouldn't install Lume automatically: ${err.message}`);
  console.error(`Download it directly: ${RELEASES_PAGE}`);
  process.exit(1);
});
