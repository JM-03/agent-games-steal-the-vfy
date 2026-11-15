// Demo: defensive strategy — a SECOND committed strategy that exercises
// the FORTIFY and HOLD branches the main demo never reaches.
//
// The main demo uses params [10,0,0,0,0,0,0,0] (always EXTRACT 10), so
// FORTIFY and HOLD only exist in the test suite. This demo proves the
// decision list is general, not a one-branch trick: the same commitment
// pattern, different params — [5,50,20,0,0,0,0,0] — played in two
// 20-turn matches against two scripted opponents:
//
//   Scenario A — "under attack": the opponent extracts 10 while we are
//     healthy (balance >= 50), then 5 once we are weakened. Our balance
//     falls below 50 at turn 11, so FORTIFY fires for turns 12-20.
//     This match LOSES on points (22-160) — the point is not the score,
//     it is that every defensive move was proven against the committed
//     policy.
//   Scenario B — "draining a passive opponent": the opponent never acts
//     (HOLD). We extract 5 per turn until its balance hits 20, then the
//     strategy says HOLD for turns 17-20.
//
// Why two matches instead of one: in a single 20-turn match from 100-100
// the two defensive branches cannot both fire — FORTIFY needs OUR balance
// to fall (opponent extracts a lot) while HOLD needs THEIRS to fall
// (opponent extracts little). One commitment, two matches, both branches
// live. All turns use the REAL turn handler (src/turn.ts) and REAL
// Groth16 proofs, verified locally per turn.
//
// Resolver rules (same documented simulation as demo-match.cjs):
//   - FORTIFY costs 2 VFY and protects against extraction on the NEXT
//     turn only (fortifiedUntil = turn + 1); it blocks up to 6 VFY.
//   - EXTRACT steals up to the requested amount from the opponent's
//     balance; a fortified defender reduces the gain by 6 (min 0).
//   - Both sides' gains are computed from START-of-turn balances, then
//     applied together (simultaneous submission, like the real resolver).
//
// SECURITY: the defensive commitment lives in a SEPARATE file,
// .env.strategy-defensive (mode 0600, gitignored). This script NEVER
// reads .env.strategy and NEVER runs `npm run commitment` — the main
// commitment (0x0b9f...) must stay untouched. The salt is never printed.
// Kurier: same pattern as demo-match — ONE proof submitted at the end
// only if KURIER_API_KEY is set; otherwise skipped gracefully.
const fs = require("node:fs");
const path = require("node:path");

// --- 1. Load ONLY the defensive env file, BEFORE requiring dist/ (config reads env at import).
const dotenv = require("dotenv");
const root = path.join(__dirname, "..");
const DEFENSIVE_ENV = path.join(root, ".env.strategy-defensive");
if (!fs.existsSync(DEFENSIVE_ENV)) {
  console.error("ERROR: .env.strategy-defensive is missing. It holds the defensive salt + commitment.");
  console.error("Generate it with the one-off script (see README) — NEVER with `npm run commitment` (that overwrites .env.strategy).");
  process.exit(1);
}
const parsed = dotenv.parse(fs.readFileSync(DEFENSIVE_ENV, "utf8"));
for (const [k, v] of Object.entries(parsed)) process.env[k] = v;

const EXPECTED_PARAMS = "[5,50,20,0,0,0,0,0]";
if ((process.env.STRATEGY_PARAMS || "").replace(/\s+/g, "") !== EXPECTED_PARAMS) {
  console.error(`ERROR: expected defensive params ${EXPECTED_PARAMS}, got ${process.env.STRATEGY_PARAMS}. Refusing to run with the wrong strategy.`);
  process.exit(1);
}
const commitment = process.env.STRATEGY_COMMITMENT_HASH || "";
if (!commitment || !process.env.STRATEGY_SALT) {
  console.error("ERROR: STRATEGY_COMMITMENT_HASH / STRATEGY_SALT missing from .env.strategy-defensive.");
  process.exit(1);
}
const kurierApiKey = process.env.KURIER_API_KEY || "";
// Keep Kurier OUT of the per-turn handler (one submit only, at the end).
if (process.env.KURIER_API_KEY) delete process.env.KURIER_API_KEY;

const { handleTurn } = require(path.join(root, "dist", "turn.js"));
const { submitProofToKurier, pollKurierJob, registerKurierVk } = require(path.join(root, "dist", "proof.js"));

// Scripted opponents (deterministic, documented):
//   A — presses while we are healthy (EXTRACT 10), eases off (EXTRACT 5) once we drop below 50.
//   B — never acts (HOLD).
function opponentA(turn, startSelf, startOpp) {
  return startSelf >= 50 ? { type: "EXTRACT", amount: 10 } : { type: "EXTRACT", amount: 5 };
}
function opponentB(turn, startSelf, startOpp) {
  return { type: "HOLD" };
}

async function playMatch(name, matchId, opponentFn) {
  console.log(`\n${name}`);
  console.log(`matchId: ${matchId}`);
  let self = 100;
  let opp = 100;
  let selfFortifiedUntil = null;
  let oppFortifiedUntil = null;
  let firstProof = null;
  let proved = 0;
  let fortify = 0;
  let hold = 0;
  let extract = 0;
  let totalMs = 0;

  for (let turn = 1; turn <= 20; turn++) {
    const startSelf = self;
    const startOpp = opp;
    const envelope = {
      protocolVersion: "v1",
      eventId: "steal-the-vfy",
      matchId,
      turn,
      issuedAt: new Date().toISOString(),
      deadlineAt: new Date(Date.now() + 25_000).toISOString(),
      state: {
        selfBalance: startSelf,
        opponentBalance: startOpp,
        selfFortifiedUntilTurn: selfFortifiedUntil,
        opponentFortifiedUntilTurn: oppFortifiedUntil,
      },
      strategyCommitment: { hash: commitment },
      // No idempotencyKey on purpose: the handler derives the deterministic
      // UUIDv5 key from matchId:turn.
    };
    const t0 = Date.now();
    const outcome = await handleTurn(envelope);
    const ms = Date.now() - t0;
    totalMs += ms;
    const action = outcome.response.action;
    const hasProof = !!outcome.response.policyProof.proof && Array.isArray(outcome.response.policyProof.publicSignals);
    if (hasProof) {
      proved++;
      if (turn === 1) firstProof = outcome.response.policyProof;
    }
    if (action.type === "FORTIFY") fortify++;
    else if (action.type === "HOLD") hold++;
    else extract++;
    const oppAction = opponentFn(turn, startSelf, startOpp);

    // Resolver: gains from start-of-turn balances, applied together.
    let selfGain = 0;
    let oppGain = 0;
    let selfCost = 0;
    let oppCost = 0;
    if (action.type === "EXTRACT") {
      selfGain = Math.min(action.amount, startOpp);
      if (oppFortifiedUntil === turn) selfGain = Math.max(0, selfGain - 6);
    } else if (action.type === "FORTIFY") {
      selfCost = 2;
    }
    if (oppAction.type === "EXTRACT") {
      oppGain = Math.min(oppAction.amount, startSelf);
      if (selfFortifiedUntil === turn) oppGain = Math.max(0, oppGain - 6);
    } else if (oppAction.type === "FORTIFY") {
      oppCost = 2;
    }
    self = startSelf - oppGain - selfCost + selfGain;
    opp = startOpp - selfGain - oppCost + oppGain;
    // Fortify played this turn protects NEXT turn only.
    selfFortifiedUntil = action.type === "FORTIFY" ? turn + 1 : null;
    oppFortifiedUntil = oppAction.type === "FORTIFY" ? turn + 1 : null;

    const ourAction = action.type + (action.amount ? ` ${action.amount}` : "");
    const theirAction = oppAction.type + (oppAction.amount ? ` ${oppAction.amount}` : "");
    console.log(
      `turn ${String(turn).padStart(2)}: us ${ourAction.padEnd(11)} | opp ${theirAction.padEnd(11)} | ` +
        `proof=${outcome.proofStatus.padEnd(20)} | ${ms}ms | balances ${startSelf}->${self} / ${startOpp}->${opp}` +
        (hasProof ? "" : "  <-- NO PROOF"),
    );
  }

  console.log("");
  console.log(`Totals: ${proved}/20 turns proved + locally verified, ${totalMs}ms total, avg ${Math.round(totalMs / 20)}ms/turn.`);
  console.log(`Actions: EXTRACT x${extract}, FORTIFY x${fortify}, HOLD x${hold}.`);
  console.log(`Final balances: us ${self} — opponent ${opp} → ${self > opp ? "US WIN" : self < opp ? "OPPONENT WIN" : "DRAW"}.`);
  return { proved, fortify, hold, extract, self, opp, totalMs, firstProof };
}

async function main() {
  console.log(`Defensive demo — Steal the VFY (simulated, 2 x 20 turns)`);
  console.log(`params: ${EXPECTED_PARAMS}  commitment: ${commitment}`);
  console.log(`Kurier: ${kurierApiKey ? "key present — one proof will be submitted at the end" : "no KURIER_API_KEY — Kurier step will be skipped"}`);

  const a = await playMatch(
    "Scenario A — under attack (opponent extracts 10 while we are healthy, 5 once we drop below 50):",
    "22345678-2234-2234-2234-223456789abc",
    opponentA,
  );
  const b = await playMatch(
    "Scenario B — draining a passive opponent (opponent never acts):",
    "32345678-3234-3234-3234-323456789abc",
    opponentB,
  );

  // Kurier: exactly ONE proof (scenario A, turn 1).
  if (!kurierApiKey) {
    console.log("\nKurier step skipped: KURIER_API_KEY is not set in the environment.");
    console.log("Set it (same key the Gatekeeper service uses) and re-run to submit one proof for Finalized verification.");
  } else if (!a.firstProof) {
    console.log("\nKurier step skipped: scenario A turn 1 produced no proof to submit.");
  } else {
    console.log("\nSubmitting scenario A turn 1 proof to Kurier (VK registration first, then submit + poll)...");
    try {
      const { vkHash } = await registerKurierVk(kurierApiKey);
      console.log(`VK registered, vkHash=${vkHash}`);
      const job = await submitProofToKurier(
        { proof: a.firstProof.proof, publicSignals: a.firstProof.publicSignals },
        undefined,
        kurierApiKey,
      );
      console.log(`Kurier job submitted, jobId=${job.jobId}, status=${job.status}`);
      const final = await pollKurierJob(job, { timeoutMs: 120_000, apiKey: kurierApiKey });
      console.log(`Kurier job ${final.jobId} final status: ${final.status}`);
      if (final.proofReference) console.log(`proofReference: ${final.proofReference}`);
    } catch (e) {
      console.error(`Kurier step FAILED: ${e.message}`);
      process.exit(1);
    }
  }

  const totalProved = a.proved + b.proved;
  if (totalProved !== 40) {
    console.error(`\nDEFENSIVE DEMO FAILED: only ${totalProved}/40 turns produced a proof.`);
    process.exit(1);
  }
  console.log(`\nDEFENSIVE DEMO OK: 40/40 turns proved + locally verified across both matches (EXTRACT x${a.extract + b.extract}, FORTIFY x${a.fortify + b.fortify}, HOLD x${a.hold + b.hold}).`);
  // snarkjs leaves worker MessagePorts open after fullProve, which keeps
  // the Node event loop alive forever — exit explicitly (this is a CLI).
  process.exit(0);
}

main().catch((e) => {
  console.error(`DEMO FAILED: ${e.message}`);
  process.exit(1);
});
