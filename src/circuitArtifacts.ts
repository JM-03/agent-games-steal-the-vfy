// Pinned SHA-256 hashes of the OFFICIAL vfy-policy circuit artifacts.
//
// The .wasm and .zkey in circuits/ were downloaded from the official
// Agent Games site (see circuits/README.md). If either file is swapped,
// truncated, or corrupted, proofs would be generated against the wrong
// circuit — and self-verification against the official VK would fail
// silently downstream. So the server verifies both hashes at startup
// (see verifyCircuitArtifacts, called from startServer) and refuses to
// serve if they do not match.
//
// To re-derive the pins: `sha256sum circuits/vfy-policy.wasm
// circuits/vfy-policy_final.zkey` — the values below must match exactly.
// A copy is also kept in circuits/SHA256SUMS for humans.
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { config } from "./config";

export interface PinnedArtifact {
  file: string;
  sha256: string;
}

export const PINNED_CIRCUIT_ARTIFACTS: PinnedArtifact[] = [
  {
    file: "vfy-policy.wasm",
    sha256: "bc0998250d2baf75b89deef5306867ffa7085a08d4f7d2caf0dd63a060b134d2",
  },
  {
    file: "vfy-policy_final.zkey",
    sha256: "f9666a1655279ef27f7fee6d535ac8aa9e39286ac40ff6279fea87c21ab6ce41",
  },
];

export function sha256File(filePath: string): string {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

/**
 * Verify every pinned circuit artifact against its SHA-256.
 * Returns the verified list (file + hash). Throws on a missing file or
 * a hash mismatch — the server must never serve with a swapped circuit.
 */
export function verifyCircuitArtifacts(
  circuitsDir: string = path.join(__dirname, "..", "circuits"),
): PinnedArtifact[] {
  const verified: PinnedArtifact[] = [];
  for (const pinned of PINNED_CIRCUIT_ARTIFACTS) {
    const full = path.join(circuitsDir, pinned.file);
    if (!existsSync(full)) {
      throw new Error(`Circuit artifact missing: ${pinned.file} (expected at ${full})`);
    }
    const actual = sha256File(full);
    if (actual !== pinned.sha256) {
      throw new Error(
        `Circuit artifact hash MISMATCH for ${pinned.file}: expected ${pinned.sha256}, got ${actual}. ` +
          "Refusing to serve with a swapped circuit.",
      );
    }
    verified.push({ file: pinned.file, sha256: actual });
  }
  return verified;
}

/** vk_hash of the official circuit (kept in config; re-exported here for the pin check). */
export const OFFICIAL_VK_HASH = config.vkHash;
