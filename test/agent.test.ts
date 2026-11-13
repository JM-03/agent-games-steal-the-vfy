// Tests for the Steal the VFY agent.
// Run: npm test
// These tests use a throwaway HMAC secret (set by the npm test script) and
// NEVER touch the real platform.
import test from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/server";
import { signBody, SIGNATURE_HEADER } from "../src/hmac";
import { decideAction } from "../src/strategy";
import { computePublicInputsHash } from "../src/publicInputsHash";
import { buildCircuitInputs, ProofInputsIncompleteError } from "../src/circuitInputs";

const SECRET = process.env.AGENT_GAMES_HMAC_SECRET!;
const COMMITMENT = process.env.STRATEGY_COMMITMENT_HASH!;

const MATCH_ID = "9f4e1b2a-1111-2222-3333-444455556666";

function baseEnvelope(overrides: Record<string, unknown> = {}) {
  return {
    protocolVersion: "v1",
    eventId: "steal-the-vfy",
    mode: "competition",
    matchId: MATCH_ID,
    turn: 3,
    issuedAt: new Date().toISOString(),
    deadlineAt: new Date(Date.now() + 25_000).toISOString(),
    state: {
      selfBalance: 100,
      opponentBalance: 100,
      selfFortifiedUntilTurn: null,
      opponentFortifiedUntilTurn: null,
    },
    strategyCommitment: { hash: COMMITMENT },
    resolverVersion: "v1",
    nonce: "test-nonce-001",
    idempotencyKey: "test-key-001",
    ...overrides,
  };
}

let baseUrl = "";
let server: ReturnType<ReturnType<typeof createApp>["listen"]>;

test.before(async () => {
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

async function postAgent(payload: unknown, secret: string = SECRET) {
  const body = JSON.stringify(payload);
  const res = await fetch(`${baseUrl}/agent`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      [SIGNATURE_HEADER]: secret ? signBody(secret, body) : "",
    },
    body,
  });
  const text = await res.text();
  return { res, body: text ? JSON.parse(text) : null };
}

test("GET /health returns ok", async () => {
  const res = await fetch(`${baseUrl}/health`);
  assert.equal(res.status, 200);
  const json = (await res.json()) as Record<string, unknown>;
  assert.equal(json.ok, true);
  assert.equal(json.service, "agent-games-steal-the-vfy");
});

test("preflight with a valid signature returns ok + signed response", async () => {
  const { res, body } = await postAgent({
    type: "agent-games.preflight.v1",
    agent_id: "agt_test",
    issued_at: new Date().toISOString(),
    nonce: "abc123",
  });
  assert.equal(res.status, 200);
  assert.deepEqual(body, { ok: true, protocolVersion: "v1" });
  const sig = res.headers.get(SIGNATURE_HEADER);
  assert.ok(sig, "response must carry x-agent-games-signature");
  assert.equal(sig, signBody(SECRET, JSON.stringify(body)));
});

test("request with a bad signature is rejected (401)", async () => {
  const { res } = await postAgent(baseEnvelope(), "wrong-secret");
  assert.equal(res.status, 401);
});

test("unsigned request is rejected (401)", async () => {
  const { res } = await postAgent(baseEnvelope(), "");
  assert.equal(res.status, 401);
});

test("valid turn returns a schema-valid EXTRACT 5 with matching publicInputsHash", async () => {
  const envelope = baseEnvelope({ idempotencyKey: "test-key-extract-5" });
  const { res, body } = await postAgent(envelope);
  assert.equal(res.status, 200);
  assert.equal(body.matchId, MATCH_ID);
  assert.equal(body.turn, 3);
  assert.deepEqual(body.action, { type: "EXTRACT", amount: 5 });
  assert.equal(body.policyProof.circuitVersion, "v1");
  assert.equal(body.idempotencyKey, "test-key-extract-5");
  const expectedHash = computePublicInputsHash({
    commitmentHash: COMMITMENT,
    matchId: MATCH_ID,
    turn: 3,
    selfBalance: 100,
    opponentBalance: 100,
    action: "EXTRACT",
    amount: 5,
    circuitVersion: "v1",
  });
  assert.equal(body.policyProof.publicInputsHash, expectedHash);
});

test("replaying the same idempotencyKey returns the identical response", async () => {
  const envelope = baseEnvelope({ idempotencyKey: "test-key-replay" });
  const first = await postAgent(envelope);
  const second = await postAgent(envelope);
  assert.deepEqual(second.body, first.body);
});

test("FORTIFY response never includes action.amount", async () => {
  // Lead >= 10 and turn % 3 == 0 -> FORTIFY (rule 3).
  const envelope = baseEnvelope({
    turn: 3,
    state: { selfBalance: 115, opponentBalance: 100, selfFortifiedUntilTurn: null, opponentFortifiedUntilTurn: null },
    idempotencyKey: "test-key-fortify",
  });
  const { res, body } = await postAgent(envelope);
  assert.equal(res.status, 200);
  assert.equal(body.action.type, "FORTIFY");
  assert.ok(!("amount" in body.action), "amount must be omitted for FORTIFY");
});

test("HOLD response (opponent fortified) never includes action.amount", async () => {
  const envelope = baseEnvelope({
    state: { selfBalance: 100, opponentBalance: 100, selfFortifiedUntilTurn: null, opponentFortifiedUntilTurn: 3 },
    idempotencyKey: "test-key-hold",
  });
  const { res, body } = await postAgent(envelope);
  assert.equal(res.status, 200);
  assert.equal(body.action.type, "HOLD");
  assert.ok(!("amount" in body.action), "amount must be omitted for HOLD");
});

test("expired deadlineAt fails safe to HOLD", async () => {
  const envelope = baseEnvelope({
    deadlineAt: new Date(Date.now() - 60_000).toISOString(),
    idempotencyKey: "test-key-expired",
  });
  const { res, body } = await postAgent(envelope);
  assert.equal(res.status, 200);
  assert.equal(body.action.type, "HOLD");
});

test("commitment-hash mismatch fails safe to HOLD", async () => {
  const envelope = baseEnvelope({
    strategyCommitment: { hash: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" },
    idempotencyKey: "test-key-bad-commitment",
  });
  const { res, body } = await postAgent(envelope);
  assert.equal(res.status, 200);
  assert.equal(body.action.type, "HOLD");
});

test("strategy: late and behind extracts 10; behind by >=10 extracts 10; default extracts 5", () => {
  assert.deepEqual(
    decideAction({ turn: 19, selfBalance: 90, opponentBalance: 100, selfFortifiedUntilTurn: null, opponentFortifiedUntilTurn: null }),
    { type: "EXTRACT", amount: 10 },
  );
  assert.deepEqual(
    decideAction({ turn: 5, selfBalance: 85, opponentBalance: 100, selfFortifiedUntilTurn: null, opponentFortifiedUntilTurn: null }),
    { type: "EXTRACT", amount: 10 },
  );
  assert.deepEqual(
    decideAction({ turn: 4, selfBalance: 100, opponentBalance: 100, selfFortifiedUntilTurn: null, opponentFortifiedUntilTurn: null }),
    { type: "EXTRACT", amount: 5 },
  );
});

test("circuit inputs are honestly incomplete: buildCircuitInputs throws", () => {
  const envelope = baseEnvelope() as never;
  assert.throws(
    () => buildCircuitInputs(envelope, { type: "EXTRACT", amount: 5 }),
    (e: unknown) => e instanceof ProofInputsIncompleteError,
  );
});
