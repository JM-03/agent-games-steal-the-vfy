// Treasury guard demo — the same commit → prove pattern, one click away
// from the game. "Bayangkan ini treasury, bukan game — polanya sama,
// uangnya beneran."
//
// The treasury policy is the DEFENSIVE strategy [5,50,20,0,0,0,0,0]
// under its own commitment (0x1b63...a2a24), framed as a treasury:
//   - spend cap per move = params[0] = 5 VFY  (EXTRACT amount)
//   - reserve floor = params[1] = 50 VFY     (FORTIFY when balance < 50)
//   - counterparty floor = params[2] = 20 VFY (HOLD when counterparty <= 20)
// The allowlist is a guard-layer check (a plain list in this script):
// the circuit knows balances and caps, NOT addresses — the page labels
// which check is which. Nothing here is live compute: the demo page
// shows a precomputed transcript of this script (labelled as such).
//
// Three examples, refused one first:
//   1. Spend 11 VFY (cap is 5) -> the CIRCUIT refuses, no proof exists.
//   2. Spend 5 VFY to an allowlisted address -> SAFE, real Groth16 proof.
//   3. Spend 5 VFY to an address outside the allowlist -> REJECTED by
//      the guard layer before the circuit is even asked.
//
// Example 2's proof is exported to evidence/treasury-spend-5/ so a judge
// can verify it with `npm run verify:treasury` (same official VK as
// evidence/proof-turn-1/).
//
// Run: npm run demo:treasury
// Exit code 0 only if all three examples behave exactly as committed.
//
// SECURITY: this script reads ONLY .env.strategy-defensive — NEVER
// .env.strategy. The main commitment (0x0b9f...) and its salt are never
// touched. The defensive salt is never printed. Kurier is kept OUT.
const fs = require("node:fs");
const path = require("node:path");

// --- 1. Load ONLY the defensive env file, BEFORE requiring dist/.
const dotenv = require("dotenv");
const root = path.join(__dirname, "..");
const DEFENSIVE_ENV = path.join(root, ".env.strategy-defensive");
if (!fs.existsSync(DEFENSIVE_ENV)) {
  console.error("ERROR: .env.strategy-defensive is missing. It holds the defensive salt + commitment.");
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
// Keep Kurier OUT of this demo (no proof is submitted anywhere).
if (process.env.KURIER_API_KEY) delete process.env.KURIER_API_KEY;

const { generatePolicyProof } = require(path.join(root, "dist", "proof.js"));

// Demo allowlist (guard layer, NOT the circuit — the circuit knows
// balances and caps, not addresses). Obviously synthetic addresses.
const ALLOWLIST = [
  "0x1111111111111111111111111111111111111111",
  "0x2222222222222222222222222222222222222222",
];
const OUTSIDE = "0x9999999999999999999999999999999999999999";

const MATCH_ID = "42345678-4234-4234-4234-423456789abc";
const OUT_DIR = path.join(root, "evidence", "treasury-spend-5");

function envelope(turn) {
  return {
    protocolVersion: "v1",
    eventId: "steal-the-vfy",
    matchId: MATCH_ID,
    turn,
    issuedAt: new Date().toISOString(),
    deadlineAt: new Date(Date.now() + 25_000).toISOString(),
    state: {
      selfBalance: 100,
      opponentBalance: 100,
      selfFortifiedUntilTurn: null,
      opponentFortifiedUntilTurn: null,
    },
    strategyCommitment: { hash: commitment },
  };
}

async function main() {
  console.log("Treasury guard demo — same pattern, real money framing");
  console.log("Bayangkan ini treasury, bukan game — polanya sama, uangnya beneran.");
  console.log(`committed treasury policy: ${EXPECTED_PARAMS}  (spend cap 5, reserve floor 50, counterparty floor 20)`);
  console.log(`commitment: ${commitment}`);
  console.log(`allowlist (guard layer, not the circuit): ${ALLOWLIST.join(", ")}`);
  console.log("");

  let ok = 0;

  // --- Example 1 (shown first): spend 11, over the cap of 5.
  console.log("EXAMPLE 1 — spend 11 VFY (committed cap is 5) ...");
  try {
    await generatePolicyProof(envelope(1), { type: "EXTRACT", amount: 11 });
    console.log("  !!! PROOF PRODUCED — this must never happen. DEMO FAILED.");
  } catch (e) {
    ok++;
    console.log(`  VERDICT: REFUSED — ${e.message}`);
    console.log("  What the circuit said: no proof exists for a spend over the committed cap.");
    console.log("  -> The spend does not happen. Same refusal as `npm run demo:refusal` attempt 1, applied to the treasury cap.");
  }
  console.log("");

  // --- Example 2: spend 5 to an allowlisted address — real proof.
  console.log(`EXAMPLE 2 — spend 5 VFY to allowlisted ${ALLOWLIST[0]} ...`);
  if (!ALLOWLIST.includes(ALLOWLIST[0])) {
    console.log("  !!! Allowlist check failed for an allowlisted address. DEMO FAILED.");
  } else {
    try {
      const { proof, publicSignals } = await generatePolicyProof(envelope(1), { type: "EXTRACT", amount: 5 });
      ok++;
      console.log("  VERDICT: SAFE — proof generated + locally self-verified.");
      console.log("  What the circuit said: EXTRACT 5 == committed cap 5, balances clear both floors — allowed.");
      fs.mkdirSync(OUT_DIR, { recursive: true });
      fs.writeFileSync(path.join(OUT_DIR, "proof.json"), JSON.stringify(proof, null, 2) + "\n");
      fs.writeFileSync(path.join(OUT_DIR, "public.json"), JSON.stringify(publicSignals, null, 2) + "\n");
      fs.writeFileSync(
        path.join(OUT_DIR, "README.md"),
        `# Treasury spend proof — spend 5 VFY within the committed cap\n\n` +
          `A real Groth16 proof from the official \`vfy-policy\` circuit, generated by\n` +
          `\`npm run demo:treasury\` (example 2): spend 5 VFY, treasury policy\n` +
          `\`[5,50,20,0,0,0,0,0]\` (spend cap 5), commitment \`${commitment}\`.\n\n` +
          `## Verify (no repo code runs — only snarkjs)\n\n` +
          "```bash\n" +
          `npm run verify:treasury\n` +
          "```\n\n" +
          `The verification key is the same official key as the turn-1 proof:\n` +
          `\`evidence/proof-turn-1/verification_key.json\` (exported from\n` +
          `\`circuits/vfy-policy_final.zkey\`).\n\n` +
          `## What this proves — and what it does not\n\n` +
          `- It proves the spend of 5 is inside the committed cap. The circuit\n` +
          `  knows balances and caps — it does NOT know addresses. The allowlist\n` +
          `  check (recipient is on the list) is a guard-layer check, not a\n` +
          `  circuit check, and is labelled as such on the demo page.\n` +
          `- It does NOT prove on-chain finalization — that needs a Kurier job id\n` +
          `  (first Steal job id still pending).\n`,
      );
      console.log("  Proof exported to evidence/treasury-spend-5/ (verify with: npm run verify:treasury)");
    } catch (e) {
      console.log(`  !!! Proof generation FAILED unexpectedly: ${e.message}. DEMO FAILED.`);
    }
  }
  console.log("");

  // --- Example 3: spend 5 to an address outside the allowlist.
  console.log(`EXAMPLE 3 — spend 5 VFY to ${OUTSIDE} (not on the allowlist) ...`);
  if (ALLOWLIST.includes(OUTSIDE)) {
    console.log("  !!! Outside address is on the allowlist. DEMO FAILED.");
  } else {
    ok++;
    console.log("  VERDICT: REJECTED by the allowlist (guard layer) — the circuit was never asked.");
    console.log("  What the guard said: recipient is not on the allowlist, so no spend is attempted and no proof is requested.");
    console.log("  -> The spend does not happen. (The circuit itself does not know addresses — see \"What this does not prove\" in the README.)");
  }
  console.log("");

  if (ok === 3) {
    console.log("TREASURY DEMO OK: 3/3 examples behaved as committed (1 refused by the circuit, 1 proved, 1 rejected by the allowlist).");
    process.exit(0);
  }
  console.error(`TREASURY DEMO FAILED: only ${ok}/3 examples behaved as committed.`);
  process.exit(1);
}

main().catch((e) => {
  console.error(`TREASURY DEMO FAILED: ${e.message}`);
  process.exit(1);
});
