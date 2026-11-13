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
import { config } from "./config";
import { computePublicInputsHash } from "./publicInputsHash";
import { decideAction, toStrategyContext } from "./strategy";
import { generatePolicyProof, submitProofToKurier, pollKurierJob } from "./proof";
import { ProofInputsIncompleteError } from "./circuitInputs";
import type { Action, PolicyProof, TurnEnvelope, TurnResponse } from "./types";

export interface TurnOutcome {
  response: TurnResponse;
  /** What actually happened, for logs only — never sent to the platform. */
  proofStatus: "proved-and-finalized" | "proved-not-finalized" | "no-proof" | "proof-error";
  reason: string;
}

const seenKeys = new Map<string, TurnOutcome>();

function deriveIdempotencyKey(envelope: TurnEnvelope): string {
  if (envelope.idempotencyKey) return envelope.idempotencyKey;
  if (envelope.taskId) return envelope.taskId;
  return `${envelope.matchId}:${envelope.turn}:${envelope.nonce ?? ""}`;
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
    matchId: envelope.matchId,
    turn: envelope.turn,
    action: { type: "HOLD" },
    policyProof,
    agentTimestamp: new Date().toISOString(),
    idempotencyKey: deriveIdempotencyKey(envelope),
  };
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
      reason: "PROOF_ENABLED=false (circuit inputs incomplete) -> action returned without a Groth16 proof; platform will score it as HOLD",
    });
  }

  // Proof path: generate locally, submit to Kurier, wait for Finalized.
  try {
    const generated = await generatePolicyProof(envelope, action);
    let proofReference: string | undefined;
    if (config.kurierApiKey) {
      const job = await submitProofToKurier(generated);
      const finalized = await pollKurierJob(job, { timeoutMs: 20_000 });
      proofReference = finalized.proofReference ?? finalized.jobId;
      return finish({
        response: baseResponse({
          circuitVersion: config.circuitVersion,
          proof: generated.proof,
          publicSignals: generated.publicSignals,
          proofReference,
          publicInputsHash: hash,
        }),
        proofStatus: "proved-and-finalized",
        reason: `proof generated and Finalized on Kurier (job ${finalized.jobId})`,
      });
    }
    return finish({
      response: baseResponse({
        circuitVersion: config.circuitVersion,
        proof: generated.proof,
        publicSignals: generated.publicSignals,
        publicInputsHash: hash,
      }),
      proofStatus: "proved-not-finalized",
      reason: "proof generated locally but KURIER_API_KEY is empty, so it was not submitted for Finalized verification",
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
