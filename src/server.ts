// HTTP server for the Steal the VFY agent.
//
// Routes:
//   GET  /health  — liveness probe for Railway / the platform health check.
//   GET  /agent   — public, read-only usage info + a signed-turn example.
//                   (Sentinel Guard pattern: a GET on the handler path
//                   returns usage instead of 404, so a judge poking the
//                   endpoint learns how to call it.)
//   GET  /demo    — public, read-only demo summary (commitment, params,
//                   recorded demo results, evidence links). No secrets.
//   POST /verify  — public, read-only: verify a submitted Groth16 proof
//                   against the official vfy-policy VK with snarkjs.
//                   Accepts { proof, publicSignals }, returns
//                   { valid: true|false }. No state change, no secrets.
//   POST /agent   — the registered handler path. The platform posts signed
//                   turn envelopes AND the signed preflight request here.
//                   Register the FULL path (e.g. https://<host>/agent),
//                   not just the root — a root path that 404s fails
//                   preflight and every task (official Build page, 01).
//
// NOTE (16 Nov 2026): GET /agent, GET /demo and POST /verify are
// implemented locally and tested, but NOT yet deployed — they ship with
// the next Railway deploy (same slot as the env-var session). Until then
// the live endpoint still 404s GET /agent.
//
// Security, per the official pages:
//   - HMAC is verified against the RAW request body BEFORE parsing JSON.
//   - Every response carries x-agent-games-signature over its raw body.
//   - No secrets are ever logged.
import express from "express";
import type { NextFunction, Request, Response } from "express";
import * as snarkjs from "snarkjs";
import { assertConfigForServing, config } from "./config";
import { SIGNATURE_HEADER, signBody, verifySignature } from "./hmac";
import { handleTurn, isIdempotencyPersistent } from "./turn";
import {
  exportVerificationKey,
  generatePolicyProof,
  getKurierJobStatus,
  registerKurierVk,
} from "./proof";
import { decideAction, decideActionFromParams, toStrategyContext } from "./strategy";
import { verifyCircuitArtifacts } from "./circuitArtifacts";
import type { PreflightRequest, TurnEnvelope } from "./types";

/** One proof from the 17 Nov 2026 demo (20/20, US WIN 168–28), submitted
 * via Kurier and polled until Finalized. Public facts — the job id is the
 * Proof Reference in the Wildcard submission. */
export const KURIER_STEAL_JOB_ID = "2d523ed8-e255-11f1-838e-1e6a0d14f999";
export const KURIER_STEAL_TX_HASH =
  "0xf73f1c21c0401880ea43a08280106626568c275ab3212bf32d4ffa74c6de3c9b";
export const KURIER_STEAL_EXPLORER =
  "https://zkverify.subscan.io/extrinsic/0xf73f1c21c0401880ea43a08280106626568c275ab3212bf32d4ffa74c6de3c9b";

/** Public demo summary — the same numbers as the README Evidence table. */
export const DEMO_SUMMARY = {
  service: "agent-games-steal-the-vfy",
  circuit: "official vfy-policy (Groth16/bn128, 9 public signals)",
  vkHash: config.vkHash,
  commitment: "0x0b9f4672eb0b10bba098b648216126cb6256f43b0879833483b7f4631f61cb39",
  strategyParams: [10, 0, 0, 0, 0, 0, 0, 0],
  results: {
    demoMatch: "20/20 turns proved + locally verified, final 168–28",
    defensiveDemo: "40/40 proved + locally verified (FORTIFY x9, HOLD x4)",
    refusalDemo: "3/3 out-of-policy moves refused by the circuit",
    attackScript: "5/5 attacks blocked",
    tests: "24/24 pass",
  },
  kurierStealJobId: KURIER_STEAL_JOB_ID,
  kurier: {
    jobId: KURIER_STEAL_JOB_ID,
    status: "Finalized",
    txHash: KURIER_STEAL_TX_HASH,
    explorer: KURIER_STEAL_EXPLORER,
    vkHash: config.vkHash,
    note: "One turn-1 proof from the 17 Nov 2026 demo (20/20, US WIN 168–28), submitted via Kurier and polled until Finalized.",
  },
  links: {
    repo: "https://github.com/JM-03/agent-games-steal-the-vfy",
    demoPage: "https://jm-03.github.io/agent-games-steal-the-vfy/demo.html",
    writeup: "https://github.com/JM-03/agent-games-steal-the-vfy/blob/main/WRITEUP.md",
    proofTurn1: "https://github.com/JM-03/agent-games-steal-the-vfy/tree/main/evidence/proof-turn-1",
  },
} as const;

export function createApp() {
  const app = express();

  // Public demo API: allow any origin to call the read-only routes from
  // the GitHub Pages demo (and from a judge's browser). CORS only
  // controls browsers, not auth — HMAC enforcement for POST /agent
  // below is unchanged.
  app.use((req: Request, res: Response, next: NextFunction) => {
    res.setHeader("access-control-allow-origin", "*");
    res.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
    res.setHeader("access-control-allow-headers", "content-type, x-agent-games-signature");
    if (req.method === "OPTIONS") return res.status(204).end();
    return next();
  });

  // Capture the raw body for HMAC verification (must run before parsing).
  app.use(
    express.json({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      verify: (req: any, _res: any, buf: Buffer) => {
        req.rawBody = buf;
      },
    }),
  );

  app.get("/health", (_req: Request, res: Response) => {
    res.status(200).json({
      ok: true,
      service: "agent-games-steal-the-vfy",
      circuitVersion: config.circuitVersion,
      proofEnabled: config.proofEnabled,
      idempotencyPersistent: isIdempotencyPersistent(),
      time: new Date().toISOString(),
    });
  });

  // Public, read-only usage info for the handler path (no auth, no state).
  app.get("/agent", (_req: Request, res: Response) => {
    res.status(200).json({
      service: "agent-games-steal-the-vfy",
      usage:
        "POST /agent with a signed turn envelope: HMAC-SHA256 over the raw JSON body, " +
        "sent as the x-agent-games-signature header. Preflight: " +
        "{ type: 'agent-games.preflight.v1', agent_id, issued_at, nonce } " +
        "-> { ok: true, protocolVersion: 'v1' }. Unsigned requests are rejected with 401.",
      endpoint: "https://agent-games-steal-the-vfy-production.up.railway.app/agent",
      circuitVersion: config.circuitVersion,
      proofEnabled: config.proofEnabled,
      exampleEnvelope: {
        protocolVersion: "v1",
        eventId: "steal-the-vfy",
        matchId: "12345678-1234-1234-1234-123456789abc",
        turn: 1,
        state: { selfBalance: 100, opponentBalance: 100 },
        strategyCommitment: { hash: DEMO_SUMMARY.commitment },
      },
      tryIt: "Run the demos locally instead — no key needed: npm run demo, npm run demo:refusal, npm run attack, npm run verify:proof.",
      demoPage: DEMO_SUMMARY.links.demoPage,
      note: "This GET route is read-only usage info. It never processes a turn and never returns a proof.",
    });
  });

  // Public, read-only demo summary (no secrets — commitment is public).
  app.get("/demo", (_req: Request, res: Response) => {
    res.status(200).json(DEMO_SUMMARY);
  });

  // Public, read-only live proof on demand: one REAL turn-1 proof of the
  // recorded demo (balances 100/100, committed strategy), generated live
  // by this server — the same code path as POST /agent turns, without
  // needing the platform HMAC secret. No state change, no Kurier
  // submission: this endpoint proves, it does not publish. The on-chain
  // receipt for a demo proof is in GET /demo (kurier).
  app.get("/demo-turn", async (_req: Request, res: Response) => {
    if (!config.proofEnabled) {
      return res.status(503).json({
        ok: false,
        error: "proof generation is disabled on this deployment (PROOF_ENABLED=false)",
      });
    }
    if (!config.strategySalt || !config.strategyCommitmentHash) {
      return res.status(503).json({
        ok: false,
        error:
          "this deployment has no committed strategy configured " +
          "(STRATEGY_SALT / STRATEGY_COMMITMENT_HASH not set)",
      });
    }
    const t0 = Date.now();
    try {
      const envelope: TurnEnvelope = {
        protocolVersion: "v1",
        eventId: "steal-the-vfy",
        matchId: "52345678-5234-5234-5234-523456789abc",
        turn: 1,
        issuedAt: new Date().toISOString(),
        deadlineAt: new Date(Date.now() + 25_000).toISOString(),
        state: {
          selfBalance: 100,
          opponentBalance: 100,
          selfFortifiedUntilTurn: null,
          opponentFortifiedUntilTurn: null,
        },
        strategyCommitment: { hash: config.strategyCommitmentHash },
      };
      const action = decideAction(toStrategyContext(1, envelope.state));
      const { proof, publicSignals } = await generatePolicyProof(envelope, action);
      return res.status(200).json({
        ok: true,
        demo: "Turn 1 of the recorded 20-turn demo (balances 100/100, committed strategy).",
        matchId: envelope.matchId,
        turn: 1,
        action,
        commitment: config.strategyCommitmentHash,
        vkHash: config.vkHash,
        proof,
        publicSignals,
        valid: true,
        provingMs: Date.now() - t0,
        verifyWith: "POST /verify with { proof, publicSignals } — or npm run verify:proof for the recorded turn-1 proof.",
        note: "This endpoint proves, it does not publish: no proof is submitted to Kurier here.",
      });
    } catch (e) {
      return res.status(503).json({
        ok: false,
        error: `live proof generation failed: ${(e as Error).message}`,
      });
    }
  });

  // Public, read-only Kurier job status (the same receipt the demo page
  // links to). The Kurier API key stays server-side; only the jobId the
  // caller asks about is ever sent to Kurier.
  app.get("/proof-status/:jobId", async (req: Request, res: Response) => {
    const jobId = String(req.params.jobId ?? "");
    if (!/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(jobId)) {
      return res.status(400).json({ ok: false, error: "jobId must be a Kurier job UUID" });
    }
    if (!config.kurierApiKey) {
      return res.status(503).json({
        ok: false,
        jobId,
        error:
          "Kurier is not configured on this deployment (KURIER_API_KEY not set). " +
          "Check the job at the Subscan link in GET /demo instead.",
      });
    }
    try {
      const status = await getKurierJobStatus(jobId);
      return res.status(200).json({
        ok: true,
        jobId,
        status: status.status ?? null,
        proofReference: status.proofReference ?? null,
        raw: status.raw,
      });
    } catch (e) {
      return res.status(502).json({ ok: false, jobId, error: (e as Error).message });
    }
  });

  // Public treasury-guard check: ask the guard about a REAL spend
  // request — { amount, recipient, selfBalance, opponentBalance } — and
  // get a verdict from the live committed policy, with a real Groth16
  // proof when the spend is allowed. No HMAC, no state change, no Kurier
  // submission: this is a check, not a match turn (fixed demo matchId,
  // turn 1, fresh evaluation per call).
  //
  // The policy is the DEFENSIVE strategy [5,50,20,0,0,0,0,0] under its
  // own commitment: spend exactly params[0] (5) per move, reserve floor
  // 50, counterparty floor 20. Spends are FIXED-SIZE by commitment — a
  // different size needs a new commitment (a new policy), so asking for
  // any amount other than 5 is refused by the circuit itself, and the
  // refusal is demonstrated by actually asking the circuit.
  app.post("/treasury/check", async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const amount = body.amount;
    const recipient = typeof body.recipient === "string" ? body.recipient.trim().toLowerCase() : "";
    const selfBalance = body.selfBalance === undefined ? 100 : body.selfBalance;
    const opponentBalance = body.opponentBalance === undefined ? 100 : body.opponentBalance;
    if (typeof amount !== "number" || !Number.isInteger(amount) || amount < 1) {
      return res.status(400).json({
        ok: false,
        error: "body.amount must be a positive integer (the spend being requested, in VFY)",
      });
    }
    if (!/^0x[0-9a-f]{40}$/.test(recipient)) {
      return res.status(400).json({
        ok: false,
        error: "body.recipient must be a 0x address (40 hex chars)",
      });
    }
    if (
      typeof selfBalance !== "number" ||
      !Number.isInteger(selfBalance) ||
      selfBalance < 0 ||
      selfBalance > 100000 ||
      typeof opponentBalance !== "number" ||
      !Number.isInteger(opponentBalance) ||
      opponentBalance < 0 ||
      opponentBalance > 100000
    ) {
      return res.status(400).json({
        ok: false,
        error: "body.selfBalance / body.opponentBalance must be integers 0..100000",
      });
    }
    if (!config.treasuryParams || !config.treasurySalt || !config.treasuryCommitment) {
      return res.status(503).json({
        ok: false,
        error:
          "the treasury guard is not configured on this deployment " +
          "(STRATEGY_PARAMS_DEFENSIVE / STRATEGY_SALT_DEFENSIVE / " +
          "STRATEGY_COMMITMENT_DEFENSIVE not set); the recorded transcript " +
          "is on the demo page and in npm run demo:treasury",
      });
    }
    const params = config.treasuryParams;
    const policy = {
      params,
      commitment: config.treasuryCommitment,
      spendCap: params[0],
      reserveFloor: params[1],
      counterpartyFloor: params[2],
      note: "Spends are fixed-size by commitment: the policy spends exactly params[0] per move. A different size needs a new commitment (a new policy).",
    };
    const base = {
      policy,
      recipient,
      amount,
      selfBalance,
      opponentBalance,
      verifyWith: "POST /verify with { proof, publicSignals }",
    };
    // 1. Guard layer first: the circuit never hears about an address
    //    outside the allowlist.
    if (!config.treasuryAllowlist.includes(recipient)) {
      return res.status(200).json({
        ok: true,
        verdict: "REJECTED",
        layer: "guard",
        reason: "recipient is not on the allowlist — the circuit was never asked",
        action: null,
        proof: null,
        publicSignals: null,
        valid: false,
        ...base,
      });
    }
    // 2. The committed decision list, for the balances given.
    const ctx = toStrategyContext(1, {
      selfBalance,
      opponentBalance,
      selfFortifiedUntilTurn: null,
      opponentFortifiedUntilTurn: null,
    });
    const action = decideActionFromParams(ctx, params);
    const envelope: TurnEnvelope = {
      protocolVersion: "v1",
      eventId: "steal-the-vfy",
      matchId: "42345678-4234-4234-4234-423456789abc",
      turn: 1,
      issuedAt: new Date().toISOString(),
      deadlineAt: new Date(Date.now() + 25_000).toISOString(),
      state: {
        selfBalance,
        opponentBalance,
        selfFortifiedUntilTurn: null,
        opponentFortifiedUntilTurn: null,
      },
      strategyCommitment: { hash: config.treasuryCommitment },
    };
    const opts = {
      params,
      salt: config.treasurySalt,
      commitment: config.treasuryCommitment,
    };
    try {
      if (action.type === "EXTRACT") {
        if (amount !== params[0]) {
          // Ask the circuit for the requested spend and let it refuse:
          // the refusal itself is the evidence that only the committed
          // size can be proven.
          try {
            await generatePolicyProof(envelope, { type: "EXTRACT", amount }, opts);
            return res.status(500).json({
              ok: false,
              error: `circuit proved EXTRACT ${amount} under a cap of ${params[0]} — this must never happen`,
            });
          } catch (e) {
            return res.status(200).json({
              ok: true,
              verdict: "REFUSED",
              layer: "circuit",
              reason: `spend ${amount} is not the committed size ${params[0]} — the circuit cannot prove it`,
              circuitError: String((e as Error).message).slice(0, 300),
              action: null,
              proof: null,
              publicSignals: null,
              valid: false,
              ...base,
            });
          }
        }
        const { proof, publicSignals } = await generatePolicyProof(envelope, action, opts);
        return res.status(200).json({
          ok: true,
          verdict: "SAFE",
          layer: "circuit",
          reason: `spend ${amount} == committed cap ${params[0]}, balances clear both floors — allowed and proved`,
          action,
          proof,
          publicSignals,
          valid: true,
          ...base,
        });
      }
      // FORTIFY / HOLD branch: the spend does not happen; prove the
      // branch action instead.
      const { proof, publicSignals } = await generatePolicyProof(envelope, action, opts);
      const reason =
        action.type === "FORTIFY"
          ? `treasury balance ${selfBalance} is below the reserve floor ${params[1]} — fortify instead of spending`
          : `counterparty balance ${opponentBalance} is at or below the floor ${params[2]} — hold`;
      return res.status(200).json({
        ok: true,
        verdict: "HELD",
        layer: "circuit",
        reason,
        action,
        proof,
        publicSignals,
        valid: true,
        ...base,
      });
    } catch (e) {
      return res.status(503).json({
        ok: false,
        error: `treasury proof generation failed: ${(e as Error).message}`,
      });
    }
  });

  // Public, read-only proof verification: verify a submitted Groth16
  // proof against the OFFICIAL vfy-policy verification key with snarkjs.
  // Body: { proof, publicSignals }. Returns { valid: true|false }.
  // No state change, no secrets, no HMAC needed — this is the second,
  // independent verifier (the server's own self-verification is the first).
  app.post("/verify", async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const proof = body.proof;
    const publicSignals = body.publicSignals;
    if (!proof || typeof proof !== "object" || Array.isArray(proof)) {
      return res.status(400).json({ valid: false, error: "body.proof must be a Groth16 proof object" });
    }
    if (!Array.isArray(publicSignals) || publicSignals.length !== 9) {
      return res.status(400).json({ valid: false, error: "body.publicSignals must be an array of 9 public signals" });
    }
    try {
      const vk = await exportVerificationKey();
      const valid = await snarkjs.groth16.verify(vk, publicSignals.map(String), proof);
      return res.status(200).json({
        valid,
        circuit: "official vfy-policy (Groth16/bn128)",
        vkHash: config.vkHash,
        note: valid
          ? "The proof verifies against the official verification key."
          : "The proof does NOT verify — it is not a valid proof for these public signals.",
      });
    } catch (e) {
      return res.status(400).json({ valid: false, error: `verification failed: ${(e as Error).message}` });
    }
  });

  app.post("/agent", async (req: Request & { rawBody?: Buffer }, res: Response) => {
    const rawBody = req.rawBody ?? Buffer.from(JSON.stringify(req.body ?? {}), "utf8");
    const finish = (status: number, payload: unknown) => {
      const body = JSON.stringify(payload);
      if (config.hmacSecret) {
        res.setHeader(SIGNATURE_HEADER, signBody(config.hmacSecret, body));
      }
      res.status(status).type("application/json").send(body);
    };

    // 1. Authenticate FIRST, before trusting anything in the body.
    if (!verifySignature(config.hmacSecret, rawBody, req.headers[SIGNATURE_HEADER])) {
      return finish(401, { error: "invalid signature" });
    }

    const body = req.body as Record<string, unknown>;

    // 2. Preflight handshake (official Build page, section 02):
    //    { type: "agent-games.preflight.v1", agent_id, issued_at, nonce }
    //    -> { ok: true, protocolVersion: "v1" }, signed.
    if (body?.type === "agent-games.preflight.v1") {
      const preflight = body as unknown as PreflightRequest;
      if (preflight.issued_at) {
        const issued = Date.parse(preflight.issued_at);
        if (!Number.isNaN(issued) && Math.abs(Date.now() - issued) > 5 * 60_000) {
          return finish(401, { error: "preflight issued_at too old" });
        }
      }
      return finish(200, { ok: true, protocolVersion: "v1" });
    }

    // 3. Turn envelope.
    try {
      const outcome = await handleTurn(body as unknown as TurnEnvelope);
      // Log the outcome WITHOUT secrets (match/turn/action/reason only).
      console.log(
        `[turn] match=${String(body.matchId ?? "?").slice(0, 8)} turn=${body.turn} ` +
          `action=${outcome.response.action.type} proof=${outcome.proofStatus} reason=${outcome.reason}`,
      );
      return finish(200, outcome.response);
    } catch (e) {
      // handleTurn is designed not to throw; this is a last-resort guard.
      console.error("[turn] unexpected error:", (e as Error).message);
      return finish(200, {
        protocolVersion: "v1",
        matchId: (body as Record<string, unknown>).matchId ?? "",
        turn: (body as Record<string, unknown>).turn ?? 0,
        action: { type: "HOLD" },
        policyProof: { circuitVersion: config.circuitVersion },
        agentTimestamp: new Date().toISOString(),
        idempotencyKey: (body as Record<string, unknown>).idempotencyKey ?? "fallback",
      });
    }
  });

  // Anything else: 404 (the platform only ever calls /agent and /health).
  app.use((_req: Request, res: Response) => {
    res.status(404).json({ error: "not found" });
  });

  return app;
}

export function startServer() {
  const warnings = assertConfigForServing();
  for (const w of warnings) console.warn(`[config] WARNING: ${w}`);
  // Fail closed on a swapped circuit: verify the pinned SHA-256 hashes
  // of the official artifacts before listening at all.
  const artifacts = verifyCircuitArtifacts();
  for (const a of artifacts) {
    console.log(`[circuit] verified ${a.file} sha256=${a.sha256.slice(0, 16)}…`);
  }
  if (config.idempotencyStorePath) {
    console.log(`[store] idempotency persisted to ${config.idempotencyStorePath}`);
  } else {
    console.log("[store] idempotency in-memory only (IDEMPOTENCY_STORE_PATH not set)");
  }
  const app = createApp();
  app.listen(config.port, () => {
    console.log(`[server] steal-the-vfy agent listening on :${config.port} (proofEnabled=${config.proofEnabled})`);
  });
  // Register the circuit verification key with Kurier once, in the
  // background — never blocks listen() and never throws. Without this,
  // Kurier rejects every submit-proof job immediately (vkRegistered: true
  // with no registered VK), which is exactly what happened to the
  // Gatekeeper agent's first Kurier job on 2026-11-13.
  if (config.kurierApiKey) {
    registerKurierVk()
      .then(({ vkHash }) => console.log(`[kurier] VK terdaftar, vkHash=${vkHash}`))
      .catch((e: Error) => console.warn(`[kurier] registrasi VK gagal (submit proof akan gagal sampai VK terdaftar): ${e.message}`));
  } else {
    console.log("[kurier] registrasi VK dilewati: KURIER_API_KEY belum diset.");
  }
  return app;
}
