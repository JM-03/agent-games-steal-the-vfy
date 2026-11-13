// Probe the vfy-policy circuit to find its real input signal names.
//
// How it works: snarkjs's witness calculator accepts an input name only if
// the circuit really has that signal. Feeding a single input { name: "1" }
// either increments the "inputs set" counter ("Only 1 out of 17") — the
// name is REAL — or fails with "Too many values for input signal" — the
// name does not exist. This script runs that oracle over a candidate list.
//
// Usage: node scripts/probe-circuit-inputs.cjs [name1 name2 ...]
// With no arguments it tests the built-in candidate list and prints the
// names that the circuit accepts.
//
// Results so far (2026-11-13, ~500 names tested):
//   REAL (9 of 17): commitment, matchId, selfBalance, opponentBalance,
//                   action, amount, circuitVersion, turnNumber, salt
//   The other 8 names are still unknown — they are not on the official
//   pages, not in the artifacts, and not in any candidate list tried.
//   Do NOT guess them into src/circuitInputs.ts; fill them in only from
//   the official Steal starter prompt on /build, the circuit source, or
//   zkVerify support / Discord.
const snarkjs = require("snarkjs");
const path = require("node:path");

const WASM = path.join(__dirname, "..", "circuits", "vfy-policy.wasm");
const ZKEY = path.join(__dirname, "..", "circuits", "vfy-policy_final.zkey");

const CANDIDATES = [
  "commitment", "matchId", "selfBalance", "opponentBalance", "action", "amount",
  "circuitVersion", "turnNumber", "salt", "turn", "strategyCommitment",
  "publicInputsHash", "nonce", "strategy", "policy", "thresholds",
  "selfFortifiedUntilTurn", "opponentFortifiedUntilTurn", "resolverVersion",
  "protocolVersion", "eventId", "deadlineAt", "issuedAt",
  "extractThreshold", "fortifyThreshold", "strategySalt", "policySalt",
  "exposedBalance", "spendableBalance", "protectedBalance",
];

async function testName(name) {
  try {
    await snarkjs.groth16.fullProve({ [name]: "1" }, WASM, ZKEY);
    return "PROVED";
  } catch (e) {
    const m = e.message || "";
    if (m.includes("Only 1 out of 17")) return "VALID";
    if (m.includes("Not enough values")) return "ARRAY";
    if (m.includes("Too many values")) return "absent";
    return `other: ${m.slice(0, 100)}`;
  }
}

(async () => {
  const names = process.argv.slice(2).length > 0 ? process.argv.slice(2) : CANDIDATES;
  const valid = [];
  for (const n of names) {
    const r = await testName(n);
    console.log(`${n}: ${r}`);
    if (r === "VALID" || r === "ARRAY" || r === "PROVED") valid.push(n);
  }
  console.log(`\nReal inputs found in this run: ${JSON.stringify(valid)}`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
