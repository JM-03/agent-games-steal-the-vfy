// HTTP server for the Steal the VFY agent.
//
// Routes:
//   GET  /health  — liveness probe for Railway / the platform health check.
//   POST /agent   — the registered handler path. The platform posts signed
//                   turn envelopes AND the signed preflight request here.
//                   Register the FULL path (e.g. https://<host>/agent),
//                   not just the root — a root path that 404s fails
//                   preflight and every task (official Build page, 01).
//
// Security, per the official pages:
//   - HMAC is verified against the RAW request body BEFORE parsing JSON.
//   - Every response carries x-agent-games-signature over its raw body.
//   - No secrets are ever logged.
import express from "express";
import type { Request, Response } from "express";
import { assertConfigForServing, config } from "./config";
import { SIGNATURE_HEADER, signBody, verifySignature } from "./hmac";
import { handleTurn } from "./turn";
import { registerKurierVk } from "./proof";
import type { PreflightRequest, TurnEnvelope } from "./types";

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
      time: new Date().toISOString(),
    });
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
