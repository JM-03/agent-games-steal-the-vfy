// Compute the strategy-commitment hash for the default strategy.
//
// The dashboard (My Agents -> Edit agent -> Steal the VFY section) asks you
// to register an active strategy commitment before Swiss Round 1 opens.
// The platform freezes that hash when matches are paired.
//
// IMPORTANT: the exact commitment format is defined by the platform, not by
// this script. This script only produces a canonical SHA-256 hash of the
// strategy descriptor (name + rules + constants) so you have a stable,
// reproducible value to compare against what the dashboard shows. If the
// dashboard instead asks you to paste a hash of the policy circuit itself,
// use the vk_hash from circuits/circuit-info.json
// (0x6c56509f1c56fd1fd4e9737f906d2220f4b95f1d507f1adf6899085bd74be047)
// and follow the dashboard's own instructions.
//
// Usage: node scripts/commitment.cjs
// Then set STRATEGY_COMMITMENT_HASH=<hash> in your .env.
const crypto = require("node:crypto");

// Keep in sync with src/strategy.ts (strategyDescriptor()).
const descriptor = {
  name: "conservative-default-v1",
  description:
    "Late-and-behind: EXTRACT 10. Opponent fortified: HOLD. Ahead by >=10 every 3rd turn: FORTIFY. Behind by >=10: EXTRACT 10. Otherwise: EXTRACT 5.",
  rules: [
    "turn>=18 and behind -> EXTRACT 10",
    "opponent fortified this turn -> HOLD",
    "lead>=10 and turn%3==0 -> FORTIFY",
    "deficit>=10 -> EXTRACT 10",
    "otherwise -> EXTRACT 5",
  ],
  constants: {
    extractMax: 10,
    extractDefault: 5,
    fortifyCost: 2,
    fortifyBlock: 6,
    matchTurns: 20,
  },
};

const canonical = JSON.stringify(descriptor);
const hash = "0x" + crypto.createHash("sha256").update(canonical, "utf8").digest("hex");
console.log(`Strategy descriptor: ${canonical}`);
console.log(`SHA-256 commitment:  ${hash}`);
console.log(`\nSet in .env: STRATEGY_COMMITMENT_HASH=${hash}`);
console.log(
  "NOTE: confirm in the dashboard whether it wants this hash or the policy-circuit vk_hash " +
    "(0x6c56509f1c56fd1fd4e9737f906d2220f4b95f1d507f1adf6899085bd74be047). " +
    "The turn envelopes carry strategyCommitment.hash — the agent compares against it.",
);
