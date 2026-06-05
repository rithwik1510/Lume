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

// Resolve both the installer and its detached signature from a GitHub release.
function pickWindowsSetup(release) {
  const assets = (release && release.assets) || [];
  const exe = assets.find((a) => /-setup\.exe$/i.test(a.name));
  if (!exe) return null;
  const sig = assets.find((a) => a.name === exe.name + ".sig");
  return {
    exeName: exe.name,
    exeUrl: exe.browser_download_url,
    sigUrl: sig ? sig.browser_download_url : null,
  };
}

// Only trust HTTPS downloads from GitHub-owned hosts.
function isTrustedHost(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:") return false;
    const h = u.hostname.toLowerCase();
    return h === "github.com" || h.endsWith(".github.com") || h.endsWith(".githubusercontent.com");
  } catch {
    return false;
  }
}

module.exports = { pickWindowsSetupUrl, pickWindowsSetup, isTrustedHost };
