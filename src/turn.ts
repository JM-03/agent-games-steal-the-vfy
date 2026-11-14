// Turn handling for Steal the VFY.
//
// The rules below come straight from the official pages:
//   - Turn envelope + response schemas: /build section 06.
//   - Turn window ~30s per turn (event page); deadlineAt in the envelope
//     is authoritative — never answer after it.
//   - Missing/invalid responses are substituted with HOLD (event page,
//     "Handle failure gracefully") and cost a reliability penalty, so on
//     ANY error or uncertainty this handler answers HOLD, never a guess.
//   - Never send action.amount for HOLD or FORTIFY — the schema rejects
//     the field even when it is 0 (/build, "Common mistakes").
//   - One idempotencyKey per turn only; the platform retries after network
//     failures, so a repeated key must return the SAME response.
//   - The commitment hash in the envelope must match the one registered
//     before pairing; a mismatch means this agent is not the paired one.
import { createHash } from "node:crypto";
import { config } from "./config";
import { computePublicInputsHash } from "./publicInputsHash";
import { decideAction, toStrategyContext } from "./strategy";
import { generatePolicyProof, submitProofToKurier, pollKurierJob, type GeneratedProof } from "./proof";
import { ProofInputsIncompleteError } from "./circuitInputs";
import type { Action, PolicyProof, TurnEnvelope, TurnResponse } from "./types";

export interface TurnOutcome {
  response: TurnResponse;
  /** What actually happened, for logs only — never sent to the platform. */
  proofStatus: "proved-kurier-background" | "proved-not-finalized" | "no-proof" | "proof-error";
  reason: string;
}

const seenKeys = new Map<string, TurnOutcome>();

/**
 * Deterministic UUIDv5-style idempotency key for one turn.
 * SHA-256 over "matchId:turn", formatted as a UUID with the version (5)
 * and variant bits set. A platform retry reuses the same key (same
 * response is returned from the cache); a new turn never reuses one.
 * A key sent by the platform itself always wins over the derived one.
 */
export function deriveIdempotencyKey(envelope: TurnEnvelope): string {
  if (envelope.idempotencyKey) return envelope.idempotencyKey;
  const digest = createHash("sha256").update(`${envelope.matchId}:${envelope.turn}`, "utf8").digest();
  // Set UUID version 5 and RFC 4122 variant bits.
  digest[6] = (digest[6] & 0x0f) | 0x50;
  digest[8] = (digest[8] & 0x3f) | 0x80;
  const hex = digest.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function isExpired(envelope: TurnEnvelope): boolean {
  if (!envelope.deadlineAt) return false;
  const deadline = Date.parse(envelope.deadlineAt);
  if (Number.isNaN(deadline)) return false;
  // Leave a 2-second safety margin so the response can still travel.
  return Date.now() > deadline - 2000;
}

function holdResponse(envelope: TurnEnvelope, hash: string | undefined): TurnResponse {
  const policyProof: PolicyProof = { circuitVersion: config.circuitVersion };
  if (hash) policyProof.publicInputsHash = hash;
  return {
    protocolVersion: "v1",
    matchId: envelope.matchId,
    turn: envelope.turn,
    action: { type: "HOLD" },
    policyProof,
    agentTimestamp: new Date().toISOString(),
    idempotencyKey: deriveIdempotencyKey(envelope),
  };
}

/**
 * Submit a proof to Kurier in the background (fire-and-forget). The
 * platform's turn window is ~30 s and it attests turns itself, so the
 * response must never wait on a Kurier job reaching Finalized (the old
 * code waited up to 20 s inside the handler — a timeout risk, report
 * §7.4b). Logs the job id and final status; never throws, never blocks
 * the response. Same pattern as the Gatekeeper agent's
 * registerKurierVkInBackground().
 */
function submitToKurierInBackground(generated: GeneratedProof, matchId: string, turn: number): void {
  if (!config.kurierApiKey) return;
  void submitProofToKurier(generated)
    .then((job) => {
      console.log(
        `[kurier] turn proof submitted: match=${matchId.slice(0, 8)} turn=${turn} jobId=${job.jobId} status=${job.status}`,
      );
      return pollKurierJob(job, { timeoutMs: 120_000 });
    })
    .then((finalized) => {
      console.log(
        `[kurier] job ${finalized.jobId} final status: ${finalized.status}` +
          (finalized.proofReference ? ` proofReference=${finalized.proofReference}` : ""),
      );
    })
    .catch((e: Error) => {
      console.warn(
        `[kurier] background submit failed (match=${matchId.slice(0, 8)} turn=${turn}): ${e.message}`,
      );
    });
}

function validateEnvelope(envelope: TurnEnvelope): string | null {
  if (!envelope || typeof envelope !== "object") return "envelope is not an object";
  if (envelope.eventId && envelope.eventId !== "steal-the-vfy") {
    return `unexpected eventId: ${envelope.eventId}`;
  }
  if (!envelope.matchId || typeof envelope.matchId !== "string") return "missing matchId";
  if (!Number.isInteger(envelope.turn) || envelope.turn < 1 || envelope.turn > 20) {
    return `turn out of range: ${envelope.turn}`;
  }
  if (!envelope.state) return "missing state";
  const self = Number(envelope.state.selfBalance);
  const opp = Number(envelope.state.opponentBalance);
  if (!Number.isFinite(self) || !Number.isFinite(opp) || self < 0 || opp < 0) {
    return "balances are not valid non-negative numbers";
  }
  if (!envelope.strategyCommitment?.hash) return "missing strategyCommitment.hash";
  return null;
}

/**
 * Handle one signed turn envelope and return the signed response.
 * This function NEVER throws for a bad turn: any problem becomes a HOLD
 * response (the platform's own fallback), with the reason in `reason`.
 */
export async function handleTurn(envelope: TurnEnvelope): Promise<TurnOutcome> {
  const key = deriveIdempotencyKey(envelope);
  const cached = seenKeys.get(key);
  if (cached) return cached; // platform retry: same key, same response

  const finish = (outcome: TurnOutcome): TurnOutcome => {
    seenKeys.set(key, outcome);
    if (seenKeys.size > 1000) {
      // Bound memory: drop the oldest entries.
      const first = seenKeys.keys().next().value;
      if (first) seenKeys.delete(first);
    }
    return outcome;
  };

  const invalid = validateEnvelope(envelope);
  if (invalid) {
    return finish({
      response: holdResponse(envelope, undefined),
      proofStatus: "no-proof",
      reason: `invalid envelope (${invalid}) -> HOLD`,
    });
  }

  // Commitment check: the envelope's frozen hash must be ours.
  const envelopeHash = envelope.strategyCommitment!.hash!.toLowerCase();
  if (config.strategyCommitmentHash && envelopeHash !== config.strategyCommitmentHash) {
    return finish({
      response: holdResponse(envelope, undefined),
      proofStatus: "no-proof",
      reason: `strategyCommitment.hash mismatch (${envelopeHash} != configured) -> HOLD`,
    });
  }

  if (isExpired(envelope)) {
    return finish({
      response: holdResponse(envelope, undefined),
      proofStatus: "no-proof",
      reason: "deadlineAt already passed -> HOLD",
    });
  }

  const action: Action = decideAction(toStrategyContext(envelope.turn, envelope.state));

  // publicInputsHash is computed from the game state exactly as specified.
  // It is an optional audit pointer and is safe to include even without a proof.
  let hash: string | undefined;
  try {
    hash = computePublicInputsHash({
      commitmentHash: envelope.strategyCommitment!.hash!,
      matchId: envelope.matchId,
      turn: envelope.turn,
      selfBalance: envelope.state.selfBalance,
      opponentBalance: envelope.state.opponentBalance,
      action: action.type,
      amount: action.type === "EXTRACT" ? action.amount : 0,
      circuitVersion: config.circuitVersion,
    });
  } catch (e) {
    return finish({
      response: holdResponse(envelope, undefined),
      proofStatus: "no-proof",
      reason: `publicInputsHash failed (${(e as Error).message}) -> HOLD`,
    });
  }

  const baseResponse = (policyProof: PolicyProof): TurnResponse => ({
    protocolVersion: "v1",
    matchId: envelope.matchId,
    turn: envelope.turn,
    // action.amount is included ONLY for EXTRACT (schema rule).
    action,
    policyProof,
    agentTimestamp: new Date().toISOString(),
    idempotencyKey: key,
  });

  if (!config.proofEnabled) {
    return finish({
      response: baseResponse({ circuitVersion: config.circuitVersion, publicInputsHash: hash }),
      proofStatus: "no-proof",
      reason: "PROOF_ENABLED=false -> action returned without a Groth16 proof; platform will score it as HOLD",
    });
  }

  // Proof path: generate locally and self-verify, then respond
  // IMMEDIATELY. Kurier submission runs in the background — the platform
  // attests turns itself and the turn window is ~30 s, so the response
  // must never wait up to 20 s for a Finalized job (report §7.4b).
  try {
    const generated = await generatePolicyProof(envelope, action);
    const kurierBackground = !!config.kurierApiKey;
    submitToKurierInBackground(generated, envelope.matchId, envelope.turn);
    return finish({
      response: baseResponse({
        circuitVersion: config.circuitVersion,
        proof: generated.proof,
        publicSignals: generated.publicSignals,
        publicInputsHash: hash,
      }),
      proofStatus: kurierBackground ? "proved-kurier-background" : "proved-not-finalized",
      reason: kurierBackground
        ? "proof generated and self-verified; Kurier submission running in background"
        : "proof generated locally but KURIER_API_KEY is empty, so it was not submitted for Finalized verification",
    });
  } catch (e) {
    const message = e instanceof ProofInputsIncompleteError ? e.message : (e as Error).message;
    return finish({
      response: holdResponse(envelope, hash),
      proofStatus: "proof-error",
      reason: `proof failed (${message}) -> HOLD`,
    });
  }
}
