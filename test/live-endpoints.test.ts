// Tests for the public live endpoints: GET /demo-turn,
// POST /treasury/check, GET /proof-status, CORS.
// Run: npm run test:live
// Uses EPHEMERAL salts + commitments generated fresh in-test (never a
// committed value) and a throwaway HMAC secret. Never touches the real
// platform, never submits anything to Kurier. Env is set BEFORE the
// server module is imported (config reads env at import time), via a
// dynamic import — do not move the import to the top of the file.
import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { computeCommitment } from "../src/poseidon";

const MAIN_PARAMS = [10, 0, 0, 0, 0, 0, 0, 0];
const TREASURY_PARAMS = [5, 50, 20, 0, 0, 0, 0, 0];
const ALLOWLISTED = "0x1111111111111111111111111111111111111111";
const ALLOWLISTED_2 = "0x2222222222222222222222222222222222222222";
const OUTSIDE = "0x9999999999999999999999999999999999999999";

let baseUrl = "";
let server: ReturnType<ReturnType<typeof import("../src/server")["createApp"]>["listen"]>;
let mainCommitment = "";

async function postJson(path: string, payload: unknown) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  return { res, body: text ? (JSON.parse(text) as Record<string, unknown>) : null };
}

async function postVerify(proof: unknown, publicSignals: unknown) {
  return postJson("/verify", { proof, publicSignals });
}

test.before(async () => {
  const mainSalt = "0x" + randomBytes(31).toString("hex");
  mainCommitment = await computeCommitment(MAIN_PARAMS, mainSalt);
  const treasurySalt = "0x" + randomBytes(31).toString("hex");
  const treasuryCommitment = await computeCommitment(TREASURY_PARAMS, treasurySalt);
  process.env.AGENT_GAMES_HMAC_SECRET = "test-secret-for-live-endpoints-only";
  process.env.STRATEGY_PARAMS = JSON.stringify(MAIN_PARAMS);
  process.env.STRATEGY_SALT = mainSalt;
  process.env.STRATEGY_COMMITMENT_HASH = mainCommitment;
  process.env.STRATEGY_PARAMS_DEFENSIVE = JSON.stringify(TREASURY_PARAMS);
  process.env.STRATEGY_SALT_DEFENSIVE = treasurySalt;
  process.env.STRATEGY_COMMITMENT_DEFENSIVE = treasuryCommitment;
  process.env.TREASURY_ALLOWLIST = `${ALLOWLISTED},${ALLOWLISTED_2}`;
  process.env.PROOF_ENABLED = "true";
  delete process.env.KURIER_API_KEY;
  const { createApp } = await import("../src/server");
  const app = createApp();
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("could not bind test server");
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

test.after(() => {
  server.close();
});

test("GET /demo-turn returns a fresh real proof for turn 1", async () => {
  const t0 = Date.now();
  const res = await fetch(`${baseUrl}/demo-turn`);
  const ms = Date.now() - t0;
  assert.equal(res.status, 200);
  const json = (await res.json()) as Record<string, unknown>;
  assert.equal(json.ok, true);
  assert.equal(json.valid, true);
  assert.deepEqual(json.action, { type: "EXTRACT", amount: 10 });
  assert.equal(json.commitment, mainCommitment);
  assert.equal((json.publicSignals as string[]).length, 9);
  assert.equal(typeof json.provingMs, "number");
  assert.ok((json.provingMs as number) < 20_000, "proof must arrive well inside the 20s proving timeout");
  console.log(`  [timing] GET /demo-turn round-trip: ${ms}ms (provingMs=${json.provingMs})`);
  // The returned proof verifies through the public /verify route.
  const checked = await postVerify(json.proof, json.publicSignals);
  assert.equal(checked.res.status, 200);
  assert.equal(checked.body?.valid, true);
});

test("GET /demo shows the Finalized Kurier job, not null", async () => {
  const res = await fetch(`${baseUrl}/demo`);
  assert.equal(res.status, 200);
  const json = (await res.json()) as Record<string, unknown>;
  assert.equal(json.kurierStealJobId, "2d523ed8-e255-11f1-838e-1e6a0d14f999");
  const kurier = json.kurier as Record<string, string>;
  assert.equal(kurier.status, "Finalized");
  assert.equal(kurier.txHash, "0xf73f1c21c0401880ea43a08280106626568c275ab3212bf32d4ffa74c6de3c9b");
  assert.match(kurier.explorer, /zkverify\.subscan\.io\/extrinsic\/0xf73f1c21/);
});

test("POST /treasury/check: spend 5 to an allowlisted address is SAFE with a real proof", async () => {
  const { res, body } = await postJson("/treasury/check", {
    amount: 5,
    recipient: ALLOWLISTED,
    selfBalance: 100,
    opponentBalance: 100,
  });
  assert.equal(res.status, 200);
  assert.equal(body?.ok, true);
  assert.equal(body?.verdict, "SAFE");
  assert.equal(body?.layer, "circuit");
  assert.deepEqual(body?.action, { type: "EXTRACT", amount: 5 });
  assert.equal(body?.valid, true);
  assert.equal((body?.publicSignals as string[]).length, 9);
  const checked = await postVerify(body?.proof, body?.publicSignals);
  assert.equal(checked.body?.valid, true);
});

test("POST /treasury/check: spend 11 to an allowlisted address is REFUSED by the circuit", async () => {
  const { res, body } = await postJson("/treasury/check", {
    amount: 11,
    recipient: ALLOWLISTED,
    selfBalance: 100,
    opponentBalance: 100,
  });
  assert.equal(res.status, 200);
  assert.equal(body?.verdict, "REFUSED");
  assert.equal(body?.layer, "circuit");
  assert.equal(body?.proof, null);
  assert.equal(body?.valid, false);
  assert.match(String(body?.reason), /not the committed size 5/);
});

test("POST /treasury/check: spend 3 (not the committed size) is REFUSED", async () => {
  const { res, body } = await postJson("/treasury/check", {
    amount: 3,
    recipient: ALLOWLISTED,
    selfBalance: 100,
    opponentBalance: 100,
  });
  assert.equal(res.status, 200);
  assert.equal(body?.verdict, "REFUSED");
  assert.equal(body?.proof, null);
});

test("POST /treasury/check: spend 5 outside the allowlist is REJECTED by the guard layer", async () => {
  const { res, body } = await postJson("/treasury/check", {
    amount: 5,
    recipient: OUTSIDE,
    selfBalance: 100,
    opponentBalance: 100,
  });
  assert.equal(res.status, 200);
  assert.equal(body?.verdict, "REJECTED");
  assert.equal(body?.layer, "guard");
  assert.equal(body?.proof, null);
});

test("POST /treasury/check: balance below the reserve floor is HELD with a FORTIFY proof", async () => {
  const { res, body } = await postJson("/treasury/check", {
    amount: 5,
    recipient: ALLOWLISTED,
    selfBalance: 40,
    opponentBalance: 100,
  });
  assert.equal(res.status, 200);
  assert.equal(body?.verdict, "HELD");
  assert.deepEqual(body?.action, { type: "FORTIFY" });
  assert.equal(body?.valid, true);
  const checked = await postVerify(body?.proof, body?.publicSignals);
  assert.equal(checked.body?.valid, true);
});

test("POST /treasury/check: counterparty below the floor is HELD with a HOLD proof", async () => {
  const { res, body } = await postJson("/treasury/check", {
    amount: 5,
    recipient: ALLOWLISTED,
    selfBalance: 100,
    opponentBalance: 10,
  });
  assert.equal(res.status, 200);
  assert.equal(body?.verdict, "HELD");
  assert.deepEqual(body?.action, { type: "HOLD" });
  assert.equal(body?.valid, true);
  const checked = await postVerify(body?.proof, body?.publicSignals);
  assert.equal(checked.body?.valid, true);
});

test("POST /treasury/check: malformed bodies are 400, never a crash", async () => {
  const missing = await postJson("/treasury/check", { recipient: ALLOWLISTED });
  assert.equal(missing.res.status, 400);
  const badRecipient = await postJson("/treasury/check", { amount: 5, recipient: "not-an-address" });
  assert.equal(badRecipient.res.status, 400);
  const badAmount = await postJson("/treasury/check", { amount: 0, recipient: ALLOWLISTED });
  assert.equal(badAmount.res.status, 400);
});

test("GET /proof-status: bad jobId is 400, unconfigured Kurier is 503", async () => {
  const bad = await fetch(`${baseUrl}/proof-status/not-a-uuid`);
  assert.equal(bad.status, 400);
  const noKey = await fetch(`${baseUrl}/proof-status/2d523ed8-e255-11f1-838e-1e6a0d14f999`);
  assert.equal(noKey.status, 503);
  const json = (await noKey.json()) as Record<string, unknown>;
  assert.match(String(json.error), /KURIER_API_KEY not set/);
});

test("CORS: public routes allow any origin, OPTIONS preflight is 204", async () => {
  const res = await fetch(`${baseUrl}/demo-turn`);
  assert.equal(res.headers.get("access-control-allow-origin"), "*");
  const preflight = await fetch(`${baseUrl}/treasury/check`, {
    method: "OPTIONS",
    headers: { origin: "https://jm-03.github.io", "access-control-request-method": "POST" },
  });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("access-control-allow-origin"), "*");
});
