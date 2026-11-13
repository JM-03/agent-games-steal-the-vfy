// Groth16 policy-proof generation (snarkjs) + Kurier submission.
//
// Flow per the official Build page (sections 02.5 and 03):
//   1. Generate the proof LOCALLY with snarkjs from the downloaded
//      circuits/vfy-policy.wasm + circuits/vfy-policy_final.zkey.
//   2. Submit it to Kurier (recommended REST path) with the registered
//      vk_hash, then poll until the job reaches "Finalized".
//   3. Only then treat the proof as confirmed.
//
// BLOCKER, stated plainly: step 1 cannot produce a valid proof yet, because
// 8 of the 17 circuit input names are not published anywhere (see
// src/circuitInputs.ts and CIRCUIT_NOTES.md). generatePolicyProof() therefore
// throws ProofInputsIncompleteError, and the turn handler fails safe to HOLD
// with no proof — exactly what the platform does for a turn with a missing
// proof ("Missing or invalid responses substitute HOLD").
import * as snarkjs from "snarkjs";
import { config } from "./config";
import { buildCircuitInputs, ProofInputsIncompleteError } from "./circuitInputs";
import type { Action, TurnEnvelope } from "./types";

export { ProofInputsIncompleteError };

export interface GeneratedProof {
  proof: unknown;
  publicSignals: string[];
}

/**
 * Generate a Groth16 policy proof for one turn.
 * Throws ProofInputsIncompleteError while circuit inputs are missing, or
 * any snarkjs error if proof generation itself fails. Never returns a
 * half-made proof: callers treat any throw as "no proof available".
 */
export async function generatePolicyProof(
  envelope: TurnEnvelope,
  action: Action,
): Promise<GeneratedProof> {
  const inputs = buildCircuitInputs(envelope, action);
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(
    inputs,
    config.wasmPath,
    config.zkeyPath,
  );
  return { proof, publicSignals: publicSignals.map(String) };
}

export type KurierStatus = "Submitted" | "IncludedInBlock" | "Finalized" | string;

export interface KurierJob {
  jobId?: string;
  status?: KurierStatus;
  proofReference?: string;
  raw: unknown;
}

function kurierHeaders(): Record<string, string> {
  return { "content-type": "application/json" };
}

/**
 * Submit a proof to Kurier for verification.
 * Endpoint and body shape are from the official Build page, section 03:
 *   POST {KURIER_API_URL}/submit-proof/{KURIER_API_KEY}
 *   { proofType: "groth16", vkRegistered: true,
 *     proofOptions: { library: "snarkjs", curve: "bn128" },
 *     proofData: { proof, publicSignals, vk: <registered vkHash> } }
 * Returns the job object; poll with pollKurierJob() until Finalized.
 * Throws on network/HTTP errors or when no API key is configured.
 */
export async function submitProofToKurier(
  generated: GeneratedProof,
  vkHash: string = config.vkHash,
): Promise<KurierJob> {
  if (!config.kurierApiKey) {
    throw new Error("KURIER_API_KEY is not configured; cannot submit a proof to Kurier.");
  }
  const url = `${config.kurierApiUrl}/submit-proof/${config.kurierApiKey}`;
  const res = await fetch(url, {
    method: "POST",
    headers: kurierHeaders(),
    body: JSON.stringify({
      proofType: "groth16",
      vkRegistered: true,
      proofOptions: { library: "snarkjs", curve: "bn128" },
      proofData: { proof: generated.proof, publicSignals: generated.publicSignals, vk: vkHash },
    }),
  });
  if (!res.ok) {
    throw new Error(`Kurier submit-proof failed: HTTP ${res.status} ${await res.text()}`);
  }
  const raw = (await res.json()) as Record<string, unknown>;
  return {
    jobId: (raw.jobId as string) ?? (raw.id as string),
    status: (raw.status as string) ?? "Submitted",
    proofReference: (raw.proofReference as string) ?? (raw.jobId as string),
    raw,
  };
}

/**
 * Poll a Kurier job until it reaches "Finalized" or the timeout elapses.
 * The job-status endpoint is not spelled out on the Build page, so this
 * uses the documented job resource path and treats an unknown/absent
 * status field as "still pending". If the endpoint shape differs, this
 * function throws and the caller fails safe — it never reports a proof
 * as Finalized without evidence.
 */
export async function pollKurierJob(
  job: KurierJob,
  opts: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<KurierJob> {
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const intervalMs = opts.intervalMs ?? 2_000;
  if (!job.jobId) throw new Error("Kurier job has no jobId to poll.");
  const deadline = Date.now() + timeoutMs;
  let current = job;
  while (Date.now() < deadline) {
    if (current.status === "Finalized") return current;
    await new Promise((r) => setTimeout(r, intervalMs));
    const res = await fetch(
      `${config.kurierApiUrl}/job/${encodeURIComponent(job.jobId)}`,
      { headers: kurierHeaders() },
    );
    if (!res.ok) {
      throw new Error(`Kurier job poll failed: HTTP ${res.status}`);
    }
    const raw = (await res.json()) as Record<string, unknown>;
    current = {
      jobId: job.jobId,
      status: (raw.status as string) ?? current.status,
      proofReference: (raw.proofReference as string) ?? current.proofReference,
      raw,
    };
  }
  throw new Error(`Kurier job ${job.jobId} did not reach Finalized within ${timeoutMs}ms (last status: ${current.status}).`);
}
