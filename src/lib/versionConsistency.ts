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
