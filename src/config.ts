// Configuration — all secrets come from environment variables only.
// Nothing secret is hardcoded here. See .env.example.
import "dotenv/config";
import path from "node:path";

export const config = {
  port: Number(process.env.PORT || 3000),
  // HMAC secret issued ONCE by the platform (dashboard -> Rotate Secret).
  hmacSecret: process.env.AGENT_GAMES_HMAC_SECRET || "",
  kurierApiKey: process.env.KURIER_API_KEY || "",
  kurierApiUrl: (process.env.KURIER_API_URL || "https://api.kurier.xyz/api/v1").replace(/\/$/, ""),
  // Commitment hash shown in turn envelopes (strategyCommitment.hash).
  // Empty = do not check (not recommended for scored rounds).
  strategyCommitmentHash: (process.env.STRATEGY_COMMITMENT_HASH || "").toLowerCase(),
  circuitVersion: process.env.CIRCUIT_VERSION || "v1",
  // vk_hash of the vfy-policy circuit, registered on zkVerify mainnet.
  // Source: https://agentgames.zkverify.io/api/circuit-info
  // (a copy of that response is saved in circuits/circuit-info.json).
  vkHash:
    process.env.VK_HASH ||
    "0x6c56509f1c56fd1fd4e9737f906d2220f4b95f1d507f1adf6899085bd74be047",
  // Master switch for Groth16 proof generation. Default false.
  // Set to true ONLY after the 8 missing circuit input names in
  // src/circuitInputs.ts are filled in (see CIRCUIT_NOTES.md).
  proofEnabled: process.env.PROOF_ENABLED === "true",
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
  if (!config.proofEnabled) {
    warnings.push(
      "PROOF_ENABLED is false: the agent answers turns but does not generate a Groth16 policy proof. " +
        "The platform treats a turn with no proof as HOLD. See CIRCUIT_NOTES.md for why, and how to enable it.",
    );
  }
  return warnings;
}
