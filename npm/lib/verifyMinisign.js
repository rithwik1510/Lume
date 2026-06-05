"use strict";
// Minisign signature verification for the Lume installer. Pure Node crypto, no
// deps. Tauri signs updater artifacts with minisign in PREHASHED MODE ("ED" =
// Ed25519 over BLAKE2b-512 of the file). Legacy "Ed" (sign raw content) is also
// supported for robustness. The public key is embedded below (it is public).

const crypto = require("crypto");

// Identical to plugins.updater.pubkey in src-tauri/tauri.conf.json (base64 of
// the 2-line minisign public-key file). Public by nature.
const LUME_UPDATER_PUBKEY =
  "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IDQxQ0E2NDBEMEU5N0Q5ODUKUldTRjJaY09EV1RLUWZ6cnJ1M3BaT3lkVWlKWFpDTGtJY1BCdytMWUM4SitSNERkeFhvMGVXd3gK";

function extractKeyLine(pub) {
  let text = String(pub).trim();
  if (!text.startsWith("untrusted comment:") && !/^RW/.test(text)) {
    try {
      const decoded = Buffer.from(text, "base64").toString("utf8");
      if (decoded.includes("minisign public key")) text = decoded;
    } catch {
      /* not base64 — fall through */
    }
  }
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  for (const l of lines) {
    if (l.startsWith("untrusted comment:")) continue;
    return l;
  }
  return lines[lines.length - 1] || "";
}

function parsePubKey(pub) {
  const raw = Buffer.from(extractKeyLine(pub), "base64"); // 2 algo + 8 keyid + 32 key
  if (raw.length < 42) throw new Error("bad minisign public key");
  return { keyId: raw.subarray(2, 10), key: raw.subarray(10, 42) };
}

function parseSig(sigText) {
  let text = String(sigText).trim();
  if (!text.startsWith("untrusted comment:")) {
    // Tauri stores the .sig file content base64-encoded.
    text = Buffer.from(text, "base64").toString("utf8");
  }
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const sigB64 = lines[1]; // [0]=comment, [1]=signature, [2]=trusted comment, [3]=global sig
  if (!sigB64) throw new Error("bad minisign signature");
  const raw = Buffer.from(sigB64, "base64"); // 2 algo + 8 keyid + 64 sig
  if (raw.length < 74) throw new Error("bad minisign signature length");
  return { algo: raw.subarray(0, 2), keyId: raw.subarray(2, 10), sig: raw.subarray(10, 74) };
}

function ed25519PublicKey(raw32) {
  return crypto.createPublicKey({
    key: { kty: "OKP", crv: "Ed25519", x: raw32.toString("base64url") },
    format: "jwk",
  });
}

function verifyMinisign(fileBytes, sigText, pubBlob = LUME_UPDATER_PUBKEY) {
  try {
    const pub = parsePubKey(pubBlob);
    const s = parseSig(sigText);
    if (!Buffer.from(s.keyId).equals(Buffer.from(pub.keyId))) return false;
    const prehashed = s.algo[0] === 0x45 && s.algo[1] === 0x44; // "ED"
    const message = prehashed
      ? crypto.createHash("blake2b512").update(fileBytes).digest()
      : fileBytes;
    return crypto.verify(null, message, ed25519PublicKey(pub.key), s.sig);
  } catch {
    return false;
  }
}

module.exports = { verifyMinisign, LUME_UPDATER_PUBKEY };
