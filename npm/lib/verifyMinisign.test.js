"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { verifyMinisign } = require("./verifyMinisign.js");

const exePath = path.resolve(
  __dirname,
  "../../src-tauri/target/release/bundle/nsis/Lume_0.1.0-beta.1_x64-setup.exe"
);
const sigPath = exePath + ".sig";
const haveArtifact = fs.existsSync(exePath) && fs.existsSync(sigPath);

test("verifies the real local signed installer", { skip: !haveArtifact && "no local artifact" }, () => {
  const bytes = fs.readFileSync(exePath);
  const sig = fs.readFileSync(sigPath, "utf8");
  assert.equal(verifyMinisign(bytes, sig), true);
});

test("rejects tampered bytes", { skip: !haveArtifact && "no local artifact" }, () => {
  const bytes = fs.readFileSync(exePath);
  const sig = fs.readFileSync(sigPath, "utf8");
  bytes[0] ^= 0xff;
  assert.equal(verifyMinisign(bytes, sig), false);
});

test("rejects a malformed signature", () => {
  assert.equal(verifyMinisign(Buffer.from("hi"), "not-a-sig"), false);
});
