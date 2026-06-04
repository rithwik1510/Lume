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
