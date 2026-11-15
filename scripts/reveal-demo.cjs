// Reveal the DEMO strategy — the "reveal" step of commit → act → reveal.
//
// After the match, the owner opens the DEMO commitment: its params and
// its salt. Anyone can then recompute the commitment off chain and
// confirm it matches the one published before the match — proving the
// strategy was fixed in advance and never changed mid-match.
//
//   npm run reveal:demo
//
// SECURITY — read this twice:
//   - This reveals ONLY the DEMO (defensive) commitment
//     (0x1b63...a2a24, params [5,50,20,0,0,0,0,0]). That commitment is
//     demo-only: it was never registered anywhere, never used in
//     production, and its salt is worthless once revealed — that is the
//     point of the ceremony.
//   - This script reads ONLY .env.strategy-defensive. It NEVER reads
//     .env.strategy. The MAIN commitment (0x0b9f...) and its salt are
//     NEVER revealed — the main salt stays secret forever.
//   - Do NOT adapt this script to print the main salt. There is no
//     ceremony in which the main salt is revealed.
const fs = require("node:fs");
const path = require("node:path");

const dotenv = require("dotenv");
const root = path.join(__dirname, "..");
const DEFENSIVE_ENV = path.join(root, ".env.strategy-defensive");
if (!fs.existsSync(DEFENSIVE_ENV)) {
  console.error("ERROR: .env.strategy-defensive is missing.");
  process.exit(1);
}
const parsed = dotenv.parse(fs.readFileSync(DEFENSIVE_ENV, "utf8"));
const params = JSON.parse(parsed.STRATEGY_PARAMS || "[5,50,20,0,0,0,0,0]");
const salt = parsed.STRATEGY_SALT || "";
const storedCommitment = parsed.STRATEGY_COMMITMENT_HASH || "";
if (!salt || !storedCommitment) {
  console.error("ERROR: STRATEGY_SALT / STRATEGY_COMMITMENT_HASH missing from .env.strategy-defensive.");
  process.exit(1);
}

const { computeCommitment } = require(path.join(root, "dist", "poseidon.js"));

async function main() {
  console.log("Reveal — demo strategy (defensive commitment ONLY)");
  console.log(`params:     ${JSON.stringify(params)}`);
  console.log(`salt:       ${salt}`);
  console.log(`commitment: ${storedCommitment}`);
  console.log("");
  console.log("Recomputing commitment = Poseidon(params, salt) ...");
  const recomputed = await computeCommitment(params, salt);
  console.log(`recomputed: ${recomputed}`);
  if (recomputed.toLowerCase() === storedCommitment.toLowerCase()) {
    console.log("MATCH — the revealed strategy is exactly the one committed to before the match.");
    console.log("Commit → act → reveal: the strategy was fixed in advance and never changed mid-match.");
    process.exit(0);
  }
  console.error("MISMATCH — the revealed strategy does NOT match the published commitment. Something is wrong.");
  process.exit(1);
}

main().catch((e) => {
  console.error(`REVEAL FAILED: ${e.message}`);
  process.exit(1);
});
