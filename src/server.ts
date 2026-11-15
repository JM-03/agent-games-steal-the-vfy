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
import type { Request, Response } from "express";
import * as snarkjs from "snarkjs";
import { assertConfigForServing, config } from "./config";
import { SIGNATURE_HEADER, signBody, verifySignature } from "./hmac";
import { handleTurn, isIdempotencyPersistent } from "./turn";
import { exportVerificationKey, registerKurierVk } from "./proof";
import { verifyCircuitArtifacts } from "./circuitArtifacts";
import type { PreflightRequest, TurnEnvelope } from "./types";

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
  kurierStealJobId: null,
  links: {
    repo: "https://github.com/JM-03/agent-games-steal-the-vfy",
    demoPage: "https://jm-03.github.io/agent-games-steal-the-vfy/demo.html",
    writeup: "https://github.com/JM-03/agent-games-steal-the-vfy/blob/main/WRITEUP.md",
    proofTurn1: "https://github.com/JM-03/agent-games-steal-the-vfy/tree/main/evidence/proof-turn-1",
  },
} as const;

export function createApp() {
  const app = express();

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
