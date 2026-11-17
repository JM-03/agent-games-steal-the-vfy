// Configuration — all secrets come from environment variables only.
// Nothing secret is hardcoded here. See .env.example.
import "dotenv/config";
import path from "node:path";
import { parseStrategyParams } from "./strategyParams";

/** Parse an OPTIONAL strategy-params env var: unset/empty → null (feature off). */
function parseOptionalStrategyParams(raw: string | undefined): number[] | null {
  if (raw === undefined || raw.trim() === "") return null;
  return parseStrategyParams(raw); // throws on invalid JSON/shape — fail at startup, never silently
}

const DEFAULT_TREASURY_ALLOWLIST = [
  "0x1111111111111111111111111111111111111111",
  "0x2222222222222222222222222222222222222222",
];

/** Parse TREASURY_ALLOWLIST (comma-separated 0x addresses). Unset → the demo pair. */
function parseAllowlist(raw: string | undefined): string[] {
  const list =
    raw === undefined || raw.trim() === ""
      ? DEFAULT_TREASURY_ALLOWLIST
      : raw
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
  for (const a of list) {
    if (!/^0x[0-9a-fA-F]{40}$/.test(a)) {
      throw new Error(`TREASURY_ALLOWLIST entry is not a 0x address: ${a}`);
    }
  }
  return list.map((a) => a.toLowerCase());
}

export const config = {
  port: Number(process.env.PORT || 3000),
  // HMAC secret issued ONCE by the platform (dashboard -> Rotate Secret).
  hmacSecret: process.env.AGENT_GAMES_HMAC_SECRET || "",
  kurierApiKey: process.env.KURIER_API_KEY || "",
  kurierApiUrl: (process.env.KURIER_API_URL || "https://api.kurier.xyz/api/v1").replace(/\/$/, ""),
  // Commitment hash shown in turn envelopes (strategyCommitment.hash).
  // This is commitment = Poseidon(strategyParams, salt) — compute it with
  // `npm run commitment` after generating a fresh salt. Empty = do not
  // check (not recommended for scored rounds).
  strategyCommitmentHash: (process.env.STRATEGY_COMMITMENT_HASH || "").toLowerCase(),
  // The 8 strategy parameters the circuit enforces, as a JSON array.
  // Default [10,0,0,0,0,0,0,0] = always EXTRACT 10 (simplest provable
  // policy). Invalid values throw at startup — a bad policy must never
  // silently produce unprovable actions. See src/strategyParams.ts.
  strategyParams: parseStrategyParams(process.env.STRATEGY_PARAMS),
  // Random salt for the commitment (31-byte hex, "0x..."). Generate with
  // `npm run commitment`; it is saved to gitignored .env.strategy and
  // NEVER printed or logged. Without it no proof can be generated.
  strategySalt: (process.env.STRATEGY_SALT || "").trim(),
  // Optional treasury-guard policy (the DEFENSIVE strategy [5,50,20,...]).
  // All three must be set for POST /treasury/check to work. Values come
  // from .env.strategy-defensive locally (never committed) or Railway
  // Variables. Unset = the treasury route answers 503 "not configured".
  // A bad value throws at startup — a bad policy must never silently
  // produce unprovable actions.
  treasuryParams: parseOptionalStrategyParams(process.env.STRATEGY_PARAMS_DEFENSIVE),
  treasurySalt: (process.env.STRATEGY_SALT_DEFENSIVE || "").trim(),
  treasuryCommitment: (process.env.STRATEGY_COMMITMENT_DEFENSIVE || "").toLowerCase(),
  // Guard-layer allowlist for the treasury route: recipients the guard will
  // even consider. The circuit knows balances and caps, NOT addresses —
  // the allowlist is a plain list, labelled as such everywhere it appears.
  // Default = the two demo addresses used by npm run demo:treasury.
  treasuryAllowlist: parseAllowlist(process.env.TREASURY_ALLOWLIST),
  circuitVersion: process.env.CIRCUIT_VERSION || "v1",
  // vk_hash of the vfy-policy circuit, registered on zkVerify mainnet.
  // Source: https://agentgames.zkverify.io/api/circuit-info
  // (a copy of that response is saved in circuits/circuit-info.json).
  vkHash:
    process.env.VK_HASH ||
    "0x6c56509f1c56fd1fd4e9737f906d2220f4b95f1d507f1adf6899085bd74be047",
  // Master switch for Groth16 proof generation. Default true since the
  // circuit inputs were completed on 2026-11-14 (see CIRCUIT_NOTES.md).
  // Set PROOF_ENABLED=false explicitly to answer turns without a proof
  // (the platform then scores the turn as HOLD).
  proofEnabled: process.env.PROOF_ENABLED !== "false",
  // Optional persistent idempotency store (see src/store.ts). Unset =
  // memory only (previous behavior). Set to a path on a host with a
  // volume (e.g. /data/idempotency.json) to survive restarts/redeploys.
  // NOTE: Railway has no volume attached, so this only takes effect on a
  // host with persistent disk — it ships with the next deploy; until
  // then the agent keeps the in-memory behavior.
  idempotencyStorePath: process.env.IDEMPOTENCY_STORE_PATH || "",
  wasmPath: path.join(__dirname, "..", "circuits", "vfy-policy.wasm"),
  zkeyPath: path.join(__dirname, "..", "circuits", "vfy-policy_final.zkey"),
} as const;

export function assertConfigForServing(): string[] {
  const warnings: string[] = [];
  if (!config.hmacSecret) {
    warnings.push(
      "AGENT_GAMES_HMAC_SECRET is empty: inbound HMAC verification and response signing are disabled. " +
        "Set it from the dashboard Rotate Secret value before registering this endpoint.",
    );
  }
  if (!config.kurierApiKey) {
    warnings.push(
      "KURIER_API_KEY is empty: proofs will NOT be submitted to zkVerify for verification. " +
        "Get a Kurier mainnet API key before scored rounds.",
    );
  }
  if (!config.strategySalt) {
    warnings.push(
      "STRATEGY_SALT is empty: no Groth16 proof can be generated (turns will fail closed to HOLD). " +
        "Run `npm run commitment` to generate a fresh salt and save it to .env.strategy.",
    );
  }
  if (!config.proofEnabled) {
    warnings.push(
      "PROOF_ENABLED is false: the agent answers turns but does not generate a Groth16 policy proof. " +
        "The platform treats a turn with no proof as HOLD.",
    );
  }
  return warnings;
}
