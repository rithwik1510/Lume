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
