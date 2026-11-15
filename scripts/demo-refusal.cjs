// Refusal demo: watch the agent try to cheat — and fail.
//
// This is the Wildcard entry's centerpiece: the verification gate saying NO.
// It uses the REAL committed strategy (params + salt from .env.strategy,
// same as `npm run demo`) and the REAL Groth16 circuit (snarkjs +
// official vfy-policy circuit), so nothing here can be faked with slides.
//
// What it shows, in order:
//   1. An out-of-policy move (EXTRACT 11 while the committed strategy
//      caps at 10) — the circuit REFUSES to produce a proof.
//   2. An out-of-policy move on a HOLD turn (EXTRACT 10 when the opponent
//      balance is 0, where the strategy says HOLD) — the circuit REFUSES.
//   3. A replay attack: turn 1's valid proof, presented as turn 2's
//      proof — verification FAILS (public signals bind matchId +
//      turnNumber), and a platform retry of the same turn returns the
//      cached response, never a new proof.
//   4. What the agent actually answers for that same turn: HOLD, with a
//      valid proof for the in-policy action — it never sends the refused
//      move.
//   5. Fail-closed: a turn envelope with a tampered commitment hash —
//      the agent answers HOLD with NO proof instead of guessing.
//
// Run: npm run demo:refusal
// Exit code 0 only if ALL THREE refusal attempts failed AND the agent answered
// HOLD in both fail-closed cases. Any other outcome exits non-zero.
//
// SECURITY: the strategy salt is never printed. The commitment is public
// and is shown (it is already public in the README and the repo).
const fs = require("node:fs");
const path = require("node:path");

// --- 1. Load env files BEFORE requiring dist/ (config reads env at import).
const dotenv = require("dotenv");
const root = path.join(__dirname, "..");
for (const file of [".env", ".env.strategy"]) {
  const p = path.join(root, file);
  if (fs.existsSync(p)) {
    const parsed = dotenv.parse(fs.readFileSync(p, "utf8"));
    for (const [k, v] of Object.entries(parsed)) {
      if (process.env[k] === undefined) process.env[k] = v;
    }
  }
}
// Keep Kurier OUT of this demo (no proof is submitted anywhere).
if (process.env.KURIER_API_KEY) delete process.env.KURIER_API_KEY;

const snarkjs = require("snarkjs");
const { generatePolicyProof, exportVerificationKey } = require(path.join(root, "dist", "proof.js"));
const { handleTurn } = require(path.join(root, "dist", "turn.js"));

const MATCH_ID = "12345678-1234-1234-1234-123456789abe";

function envelope(turn, selfBalance, opponentBalance, commitmentHash) {
  return {
    protocolVersion: "v1",
    eventId: "steal-the-vfy",
    matchId: MATCH_ID,
    turn,
    issuedAt: new Date().toISOString(),
    deadlineAt: new Date(Date.now() + 25_000).toISOString(),
    state: {
      selfBalance,
      opponentBalance,
      selfFortifiedUntilTurn: null,
      opponentFortifiedUntilTurn: null,
    },
    strategyCommitment: { hash: commitmentHash },
  };
}

async function main() {
  const commitment = process.env.STRATEGY_COMMITMENT_HASH || "";
  if (!commitment) {
    console.error("ERROR: STRATEGY_COMMITMENT_HASH is not set. Run `npm run commitment` first (it saves .env.strategy).");
    process.exit(1);
  }
  if (!process.env.STRATEGY_SALT) {
    console.error("ERROR: STRATEGY_SALT is not set. Run `npm run commitment` first.");
    process.exit(1);
  }
  const params = process.env.STRATEGY_PARAMS || "[10,0,0,0,0,0,0,0]";

  console.log("Refusal demo — Steal the VFY (the verification gate saying NO)");
  console.log(`matchId: ${MATCH_ID}`);
  console.log(`committed params: ${params}  (EXTRACT capped at 10; HOLD when opponent balance is 0)`);
  console.log(`commitment: ${commitment}`);
  console.log("");

  let refused = 0;

  // --- Attempt 1: EXTRACT 11 — over the committed cap of 10.
  console.log("ATTEMPT 1: prove EXTRACT 11 (committed cap is 10) ...");
  try {
    await generatePolicyProof(envelope(1, 100, 100, commitment), { type: "EXTRACT", amount: 11 });
    console.log("  !!! PROOF PRODUCED — this must never happen. DEMO FAILED.");
  } catch (e) {
    refused++;
    console.log(`  CIRCUIT REFUSED: ${e.message}`);
    console.log("  -> No proof exists for this move. Nothing to send, nothing to verify.");
  }
  console.log("");

  // --- Attempt 2: EXTRACT 10 on a turn where the strategy says HOLD.
  console.log("ATTEMPT 2: prove EXTRACT 10 when opponent balance is 0 (strategy says HOLD) ...");
  try {
    await generatePolicyProof(envelope(2, 100, 0, commitment), { type: "EXTRACT", amount: 10 });
    console.log("  !!! PROOF PRODUCED — this must never happen. DEMO FAILED.");
  } catch (e) {
    refused++;
    console.log(`  CIRCUIT REFUSED: ${e.message}`);
    console.log("  -> No proof exists for this move. Nothing to send, nothing to verify.");
  }
  console.log("");

  // --- Attempt 3: replay attack — turn 1's valid proof, reused as turn 2's.
  console.log("ATTEMPT 3: replay turn 1's valid proof as turn 2's proof ...");
  let replayBlocked = false;
  let retryIdentical = false;
  try {
    const proof1 = await generatePolicyProof(envelope(1, 100, 100, commitment), { type: "EXTRACT", amount: 10 });
    const proof2 = await generatePolicyProof(envelope(2, 100, 100, commitment), { type: "EXTRACT", amount: 10 });
    const vk = await exportVerificationKey();
    // Sanity: each proof verifies against its OWN public signals.
    const own1 = await snarkjs.groth16.verify(vk, proof1.publicSignals, proof1.proof);
    const own2 = await snarkjs.groth16.verify(vk, proof2.publicSignals, proof2.proof);
    // The attack: turn 1's proof checked against turn 2's public signals.
    const replay = await snarkjs.groth16.verify(vk, proof2.publicSignals, proof1.proof);
    console.log(`  turn 1 proof vs turn 1 signals: ${own1 ? "valid" : "INVALID (unexpected)"}`);
    console.log(`  turn 2 proof vs turn 2 signals: ${own2 ? "valid" : "INVALID (unexpected)"}`);
    console.log(`  turn 1 proof vs turn 2 signals: ${replay ? "VALID — replay SUCCEEDED (must never happen)" : "INVALID — replay rejected"}`);
    if (own1 && own2 && !replay) {
      replayBlocked = true;
      console.log("  -> Public signals bind matchId + turnNumber, so a proof made for turn N does not verify for turn M.");
    }
  } catch (e) {
    console.log(`  replay check errored (treated as blocked, but unexpected): ${e.message}`);
    replayBlocked = false;
  }
  console.log("");

  // --- Same turn, sent twice (platform retry): identical response, never a new proof.
  console.log("RETRY: same turn 1 envelope sent twice (platform retry) ...");
  const first = await handleTurn(envelope(1, 100, 100, commitment));
  const second = await handleTurn(envelope(1, 100, 100, commitment));
  retryIdentical = JSON.stringify(first.response) === JSON.stringify(second.response);
  console.log(`  identical response: ${retryIdentical ? "yes" : "NO (must never happen)"}  | idempotencyKey: ${first.response.idempotencyKey}`);
  console.log(retryIdentical
    ? "  -> A retry returns the cached response. The agent never proves the same turn twice."
    : "  -> !!! Retry produced a different response. DEMO FAILED.");
  console.log("");

  // --- What the agent actually answers for that same turn (turn 2, opp 0).
  console.log("AGENT ANSWER for that same turn (turn 2, opponent balance 0):");
  const outcome = await handleTurn(envelope(2, 100, 0, commitment));
  const action = outcome.response.action;
  const hasProof = !!outcome.response.policyProof.proof;
  console.log(`  action: ${action.type}${action.amount ? " " + action.amount : ""}  | proof: ${hasProof ? "yes (valid, self-verified)" : "no"}  | proofStatus: ${outcome.proofStatus}`);
  console.log(`  reason: ${outcome.reason}`);
  const agentHeld = action.type === "HOLD";
  console.log(agentHeld
    ? "  -> The agent never sends the refused move. It answers the in-policy action (HOLD) and proves that one instead."
    : "  -> !!! Agent did NOT answer HOLD. DEMO FAILED.");
  console.log("");

  // --- Fail-closed: tampered commitment hash.
  console.log("FAIL-CLOSED: turn envelope with a tampered commitment hash ...");
  const tampered = await handleTurn(
    envelope(3, 100, 100, "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"),
  );
  const tamperedAction = tampered.response.action;
  const tamperedProof = !!tampered.response.policyProof.proof;
  console.log(`  action: ${tamperedAction.type}  | proof: ${tamperedProof ? "yes" : "no"}  | proofStatus: ${tampered.proofStatus}`);
  console.log(`  reason: ${tampered.reason}`);
  const failedClosed = tamperedAction.type === "HOLD" && !tamperedProof;
  console.log(failedClosed
    ? "  -> The agent answers HOLD with no proof instead of guessing or sending an unproven move."
    : "  -> !!! Agent did NOT fail closed. DEMO FAILED.");
  console.log("");

  if (refused === 2 && replayBlocked && retryIdentical && agentHeld && failedClosed) {
    console.log("REFUSAL DEMO OK: 3/3 out-of-policy moves refused by the circuit (over-cap, wrong-branch, replay), agent answered HOLD in both fail-closed cases.");
    console.log("A wrong move cannot be proven at all — and without a proof, the move does not happen.");
    process.exit(0);
  }
  console.error(`REFUSAL DEMO FAILED: refused=${refused}/2, replayBlocked=${replayBlocked}, retryIdentical=${retryIdentical}, agentHeld=${agentHeld}, failedClosed=${failedClosed}.`);
  process.exit(1);
}

main().catch((e) => {
  console.error(`REFUSAL DEMO FAILED: ${e.message}`);
  process.exit(1);
});
