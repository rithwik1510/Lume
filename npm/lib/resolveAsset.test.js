// npm/lib/resolveAsset.test.js
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { pickWindowsSetupUrl, isTrustedHost } = require("./resolveAsset.js");

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

test("isTrustedHost accepts https github hosts and rejects others", () => {
  assert.equal(isTrustedHost("https://github.com/owner/repo/releases/download/v1/file.exe"), true);
  assert.equal(isTrustedHost("https://objects.githubusercontent.com/releases/file.exe"), true);
  assert.equal(isTrustedHost("http://github.com/owner/repo/releases/download/v1/file.exe"), false);
  assert.equal(isTrustedHost("https://evil.com/file.exe"), false);
});
