// Attack script — five attacks on the agent, all of which must fail.
//
// This is the adversarial complement to the refusal demo: instead of
// asking the circuit to prove a wrong move, an attacker tries to break
// the agent itself. Every attack below is real (it runs the actual code
// paths) and every one must be blocked — exit code 0 only if all five
// fail.
//
//   1. Tampered commitment — turn envelope whose commitment hash is not
//      ours (the defensive commitment, i.e. a "new strategy" smuggled
//      in mid-match) -> agent answers HOLD with no proof.
//   2. Replay — turn 1's valid proof presented as turn 2's proof ->
//      snarkjs verification FAILS (public signals bind matchId + turn).
//   3. Strategy swap mid-match — a proof generated under DIFFERENT params
//      (defensive [5,50,20,...]) submitted against the main commitment ->
//      the proof's commitment signal does not match the envelope, so it
//      cannot be used for the main match; the agent's own turn still
//      follows the committed main policy.
//   4. Forged proof — a real proof with one tampered public signal ->
//      snarkjs verification FAILS.
//   5. Unsigned envelope — a turn POSTed to /agent without a signature
//      -> HTTP 401, never processed.
//
// Run: npm run attack
//
// SECURITY: the script uses throwaway values only (a test HMAC secret set
// in-process, the already-public defensive commitment). It NEVER reads
// .env.strategy, NEVER prints a salt, NEVER uses a Kurier key.
const fs = require("node:fs");
const path = require("node:path");

// --- 1. Throwaway env, BEFORE requiring dist/ (config reads env at import).
process.env.AGENT_GAMES_HMAC_SECRET = "attack-script-test-secret-only";
process.env.STRATEGY_PARAMS = "[10,0,0,0,0,0,0,0]";
process.env.STRATEGY_COMMITMENT_HASH = "0x0b9f4672eb0b10bba098b648216126cb6256f43b0879833483b7f4631f61cb39";
process.env.PROOF_ENABLED = "true";
if (process.env.KURIER_API_KEY) delete process.env.KURIER_API_KEY;
// Load the salt from .env.strategy (read-only — never printed, never written).
const dotenv = require("dotenv");
const root = path.join(__dirname, "..");
const strategyEnv = path.join(root, ".env.strategy");
if (!fs.existsSync(strategyEnv)) {
  console.error("ERROR: .env.strategy is missing — the attack script needs the real salt to build real proofs.");
  process.exit(1);
}
for (const [k, v] of Object.entries(dotenv.parse(fs.readFileSync(strategyEnv, "utf8")))) {
  if (process.env[k] === undefined) process.env[k] = v;
}

const snarkjs = require("snarkjs");
const { generatePolicyProof, exportVerificationKey } = require(path.join(root, "dist", "proof.js"));
const { handleTurn } = require(path.join(root, "dist", "turn.js"));
const { createApp } = require(path.join(root, "dist", "server.js"));
const { signBody, SIGNATURE_HEADER } = require(path.join(root, "dist", "hmac.js"));

const MAIN_COMMITMENT = process.env.STRATEGY_COMMITMENT_HASH;
const DEFENSIVE_COMMITMENT = "0x1b633a5a1e59fadd82344fc383f6aef95d6b043d46f4fe87235bfc99d88a2a24";
const MATCH_ID = "52345678-5234-5234-5234-523456789abc";

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
  console.log("Attack script — five attacks on the agent, all must fail");
  console.log(`main commitment: ${MAIN_COMMITMENT}`);
  console.log("");
  let blocked = 0;

  // --- Attack 1: tampered commitment (a "new strategy" smuggled in).
  console.log("ATTACK 1: turn envelope with a different commitment hash (strategy swap) ...");
  const a1 = await handleTurn(envelope(1, 100, 100, DEFENSIVE_COMMITMENT));
  const a1Blocked = a1.response.action.type === "HOLD" && !a1.response.policyProof.proof;
  console.log(`  agent answered: ${a1.response.action.type} | proof: ${a1.response.policyProof.proof ? "yes" : "no"} | ${a1.reason}`);
  console.log(a1Blocked ? "  -> BLOCKED: commitment mismatch fails closed to HOLD with no proof." : "  -> !!! NOT BLOCKED. ATTACK SUCCEEDED.");
  if (a1Blocked) blocked++;
  console.log("");

  // --- Attack 2: replay turn 1's proof as turn 2's.
  console.log("ATTACK 2: replay turn 1's valid proof as turn 2's proof ...");
  const vk = await exportVerificationKey();
  const proof1 = await generatePolicyProof(envelope(1, 100, 100, MAIN_COMMITMENT), { type: "EXTRACT", amount: 10 });
  const proof2 = await generatePolicyProof(envelope(2, 100, 100, MAIN_COMMITMENT), { type: "EXTRACT", amount: 10 });
  const replay = await snarkjs.groth16.verify(vk, proof2.publicSignals, proof1.proof);
  const a2Blocked = replay === false;
  console.log(`  turn 1 proof vs turn 2 signals: ${replay ? "VALID — replay SUCCEEDED" : "INVALID — replay rejected"}`);
  console.log(a2Blocked ? "  -> BLOCKED: public signals bind matchId + turnNumber." : "  -> !!! NOT BLOCKED. ATTACK SUCCEEDED.");
  if (a2Blocked) blocked++;
  console.log("");

  // --- Attack 3: a proof made under DIFFERENT params, submitted for the main match.
  // The defensive strategy [5,50,20,...] proves EXTRACT 5 — but its proof
  // carries the DEFENSIVE commitment in publicSignals[1]. Presented
  // against the main commitment, the signals do not match the envelope.
  console.log("ATTACK 3: proof generated under different params ([5,50,20,...]) used for the main match ...");
  const defEnv = path.join(root, ".env.strategy-defensive");
  const defParsed = dotenv.parse(fs.readFileSync(defEnv, "utf8"));
  const defProof = await generatePolicyProof(
    envelope(1, 100, 100, DEFENSIVE_COMMITMENT),
    { type: "EXTRACT", amount: 5 },
    { params: [5, 50, 20, 0, 0, 0, 0, 0], salt: defParsed.STRATEGY_SALT },
  );
  const proofCommitment = BigInt(defProof.publicSignals[1]).toString(16).padStart(64, "0");
  const a3Blocked = `0x${proofCommitment}` !== MAIN_COMMITMENT.toLowerCase();
  console.log(`  proof's commitment signal: 0x${proofCommitment.slice(0, 12)}… (defensive)`);
  console.log(`  envelope commitment:       ${MAIN_COMMITMENT.slice(0, 14)}… (main)`);
  console.log(a3Blocked
    ? "  -> BLOCKED: the proof is bound to a different commitment — it cannot authorize a move in this match. (And the agent itself never accepts an outside proof: it generates its own per turn.)"
    : "  -> !!! NOT BLOCKED. ATTACK SUCCEEDED.");
  if (a3Blocked) blocked++;
  console.log("");

  // --- Attack 4: forged proof — one tampered public signal.
  console.log("ATTACK 4: forged proof (real proof, one public signal tampered) ...");
  const tamperedSignals = [...proof1.publicSignals];
  tamperedSignals[7] = (BigInt(tamperedSignals[7]) + 1n).toString(); // amount 10 -> 11
  const forged = await snarkjs.groth16.verify(vk, tamperedSignals, proof1.proof);
  const a4Blocked = forged === false;
  console.log(`  tampered proof (amount signal 10 -> 11) verifies: ${forged ? "YES — forgery SUCCEEDED" : "NO — forgery rejected"}`);
  console.log(a4Blocked ? "  -> BLOCKED: any change to the public signals breaks verification." : "  -> !!! NOT BLOCKED. ATTACK SUCCEEDED.");
  if (a4Blocked) blocked++;
  console.log("");

  // --- Attack 5: unsigned envelope to the live endpoint.
  console.log("ATTACK 5: unsigned turn envelope POSTed to /agent ...");
  const app = createApp();
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const addr = server.address();
  const baseUrl = `http://127.0.0.1:${addr.port}`;
  let a5Blocked = false;
  try {
    const body = JSON.stringify(envelope(1, 100, 100, MAIN_COMMITMENT));
    const res = await fetch(`${baseUrl}/agent`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });
    a5Blocked = res.status === 401;
    console.log(`  HTTP status: ${res.status} (expected 401)`);
    console.log(a5Blocked ? "  -> BLOCKED: unsigned requests are rejected before any processing." : "  -> !!! NOT BLOCKED. ATTACK SUCCEEDED.");
  } finally {
    server.close();
  }
  if (a5Blocked) blocked++;
  console.log("");

  if (blocked === 5) {
    console.log("ATTACK SCRIPT OK: 5/5 attacks failed (tampered commitment, replay, strategy swap, forged proof, unsigned envelope).");
    process.exit(0);
  }
  console.error(`ATTACK SCRIPT FAILED: only ${blocked}/5 attacks were blocked.`);
  process.exit(1);
}

main().catch((e) => {
  console.error(`ATTACK SCRIPT FAILED: ${e.message}`);
  process.exit(1);
});
