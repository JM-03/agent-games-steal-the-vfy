// Groth16 policy-proof generation (snarkjs) + Kurier submission.
//
// Flow per the official Build page (sections 02.5 and 03):
//   1. Generate the proof LOCALLY with snarkjs from the downloaded
//      circuits/vfy-policy.wasm + circuits/vfy-policy_final.zkey.
//   2. SELF-VERIFY it locally against the official verification key
//      (exported from the .zkey) BEFORE returning it — a proof that does
//      not verify is never sent; the caller fails closed to HOLD.
//   3. Submit it to Kurier (recommended REST path) with the registered
//      vk_hash, then poll until the job reaches "Finalized".
//
// The circuit inputs are complete since 2026-11-14 (see
// src/circuitInputs.ts): 9 scalars + strategyParams[0..7], with
// commitment = Poseidon(params, salt). A proof is only generated for an
// action that matches the circuit's decision list for the configured
// params — otherwise fullProve throws the circuit assert.
import * as snarkjs from "snarkjs";
import { config } from "./config";
import {
  buildCircuitInputs,
  ProofInputsIncompleteError,
  type CircuitInputOptions,
} from "./circuitInputs";
import type { Action, TurnEnvelope } from "./types";

export { ProofInputsIncompleteError };

export interface GeneratedProof {
  proof: unknown;
  publicSignals: string[];
}

const PROOF_TIMEOUT_MS = 20_000;

/** Verification key exported from the official .zkey (cached). */
let vkPromise: Promise<unknown> | null = null;

export function exportVerificationKey(): Promise<unknown> {
  if (!vkPromise) {
    // zKey is not in snarkjs's bundled typings — use require() like the
    // Gatekeeper repo does for the same call.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const snarkjsUntyped = require("snarkjs") as {
      zKey: { exportVerificationKey: (zkeyPath: string) => Promise<unknown> };
    };
    vkPromise = snarkjsUntyped.zKey.exportVerificationKey(config.zkeyPath);
  }
  return vkPromise;
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<T>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

/**
 * Generate a Groth16 policy proof for one turn and self-verify it locally.
 * Throws ProofInputsIncompleteError when the salt/commitment/params are
 * missing or invalid, or any snarkjs error if proof generation or local
 * verification fails. Never returns an unverified proof: callers treat
 * any throw as "no proof available" and fail closed to HOLD.
 */
export async function generatePolicyProof(
  envelope: TurnEnvelope,
  action: Action,
  opts: CircuitInputOptions = {},
): Promise<GeneratedProof> {
  const inputs = buildCircuitInputs(envelope, action, opts);
  const { proof, publicSignals } = (await withTimeout(
    snarkjs.groth16.fullProve(inputs, config.wasmPath, config.zkeyPath),
    PROOF_TIMEOUT_MS,
    "snarkjs fullProve",
  )) as { proof: unknown; publicSignals: unknown[] };
  const signals = publicSignals.map(String);
  if (signals.length !== 9) {
    throw new Error(`Expected 9 public signals from the vfy-policy circuit, got ${signals.length}.`);
  }
  const vk = await exportVerificationKey();
  const valid = await snarkjs.groth16.verify(vk, signals, proof);
  if (!valid) {
    throw new Error("Generated proof FAILED local verification against the official verification key — refusing to return it.");
  }
  return { proof, publicSignals: signals };
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
 * Register the circuit verification key with Kurier once, so later
 * submit-proof calls find it (vkRegistered: true). Without this step
 * Kurier rejects jobs immediately — the Gatekeeper agent hit exactly
 * this failure on 2026-11-13 (job Failed ~223ms after submit).
 * Returns the vkHash Kurier reports. Throws on network/HTTP errors or
 * when no API key is configured.
 */
export async function registerKurierVk(apiKey: string = config.kurierApiKey): Promise<{ vkHash: string; raw: unknown }> {
  if (!apiKey) {
    throw new Error("KURIER_API_KEY is not configured; cannot register the verification key with Kurier.");
  }
  const vk = await exportVerificationKey();
  const url = `${config.kurierApiUrl}/register-vk/${apiKey}`;
  const res = await fetch(url, {
    method: "POST",
    headers: kurierHeaders(),
    body: JSON.stringify({
      proofType: "groth16",
      proofOptions: { library: "snarkjs", curve: "bn128" },
      vk,
    }),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Kurier register-vk failed: HTTP ${res.status} ${text.slice(0, 300)}`);
  }
  let raw: unknown = text;
  try {
    raw = JSON.parse(text);
  } catch {
    /* keep raw text */
  }
  const rec = raw as Record<string, unknown>;
  const vkHash =
    (typeof rec.vkHash === "string" && rec.vkHash) ||
    (typeof rec.uniq_vk_hash === "string" && rec.uniq_vk_hash) ||
    config.vkHash;
  return { vkHash, raw };
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
  apiKey: string = config.kurierApiKey,
): Promise<KurierJob> {
  if (!apiKey) {
    throw new Error("KURIER_API_KEY is not configured; cannot submit a proof to Kurier.");
  }
  const url = `${config.kurierApiUrl}/submit-proof/${apiKey}`;
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
 * Job-status endpoint (from the /build examples + docs.zkverify.io):
 *   GET {KURIER_API_URL}/job-status/{KURIER_API_KEY}/{jobId}
 * Throws on network/HTTP errors, on a Failed job, or on timeout.
 * It never reports a proof as Finalized without evidence.
 */
export async function pollKurierJob(
  job: KurierJob,
  opts: { timeoutMs?: number; intervalMs?: number; apiKey?: string } = {},
): Promise<KurierJob> {
  const timeoutMs = opts.timeoutMs ?? 120_000;
  const intervalMs = opts.intervalMs ?? 5_000;
  const apiKey = opts.apiKey ?? config.kurierApiKey;
  if (!job.jobId) throw new Error("Kurier job has no jobId to poll.");
  if (!apiKey) throw new Error("KURIER_API_KEY is not configured; cannot poll a Kurier job.");
  const deadline = Date.now() + timeoutMs;
  let current = job;
  while (Date.now() < deadline) {
    if (current.status === "Finalized") return current;
    if (current.status === "Failed") {
      throw new Error(`Kurier job ${job.jobId} Failed: ${JSON.stringify(current.raw).slice(0, 300)}`);
    }
    await new Promise((r) => setTimeout(r, intervalMs));
    const res = await fetch(
      `${config.kurierApiUrl}/job-status/${apiKey}/${encodeURIComponent(job.jobId)}`,
      { headers: kurierHeaders() },
    );
    if (!res.ok) {
      throw new Error(`Kurier job-status failed: HTTP ${res.status}`);
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
