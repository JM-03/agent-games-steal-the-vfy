// Tests for the Steal the VFY agent.
// Run: npm test
// These tests use a throwaway HMAC secret (set by the npm test script) and
// NEVER touch the real platform. The test script sets
// STRATEGY_PARAMS=[10,70,0,0,0,0,0,0] so the HTTP tests can cover all
// three circuit branches; proof tests generate their own ephemeral salt
// at runtime (never a committed value).
import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createApp } from "../src/server";
import { signBody, SIGNATURE_HEADER } from "../src/hmac";
import { decideAction, decideActionFromParams } from "../src/strategy";
import { computePublicInputsHash } from "../src/publicInputsHash";
import { buildCircuitInputs, ProofInputsIncompleteError } from "../src/circuitInputs";
import { generatePolicyProof } from "../src/proof";
import { computeCommitment } from "../src/poseidon";
import { validateStrategyParams } from "../src/strategyParams";
import type { TurnEnvelope } from "../src/types";

const SECRET = process.env.AGENT_GAMES_HMAC_SECRET!;
const COMMITMENT = process.env.STRATEGY_COMMITMENT_HASH!;

const MATCH_ID = "9f4e1b2a-1111-2222-3333-444455556666";

// Ephemeral test salt + commitment, generated fresh in test.before().
// Used only by the proof tests (passed explicitly as opts — never via env,
// so no salt value ever lands in a committed file).
let testSalt = "";
let testCommitment = "";
const TEST_PARAMS = [10, 70, 0, 0, 0, 0, 0, 0];
const DEFAULT_PARAMS = [10, 0, 0, 0, 0, 0, 0, 0];

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
  testSalt = "0x" + randomBytes(31).toString("hex");
  testCommitment = await computeCommitment(TEST_PARAMS, testSalt);
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

test("valid turn returns a schema-valid EXTRACT 10 with matching publicInputsHash", async () => {
  // Test env params are [10,70,0,0,0,0,0,0]: 100/100 -> EXTRACT 10.
  const envelope = baseEnvelope({ idempotencyKey: "test-key-extract-10" });
  const { res, body } = await postAgent(envelope);
  assert.equal(res.status, 200);
  assert.equal(body.protocolVersion, "v1");
  assert.equal(body.matchId, MATCH_ID);
  assert.equal(body.turn, 3);
  assert.deepEqual(body.action, { type: "EXTRACT", amount: 10 });
  assert.equal(body.policyProof.circuitVersion, "v1");
  assert.equal(body.idempotencyKey, "test-key-extract-10");
  const expectedHash = computePublicInputsHash({
    commitmentHash: COMMITMENT,
    matchId: MATCH_ID,
    turn: 3,
    selfBalance: 100,
    opponentBalance: 100,
    action: "EXTRACT",
    amount: 10,
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

test("turns without an idempotencyKey get a deterministic UUIDv5 key", async () => {
  const envelope = baseEnvelope({
    matchId: "12345678-1234-1234-1234-123456789abc",
    turn: 7,
    idempotencyKey: undefined,
  });
  delete (envelope as Record<string, unknown>).idempotencyKey;
  const first = await postAgent(envelope);
  const second = await postAgent(envelope);
  assert.equal(first.res.status, 200);
  assert.equal(first.body.idempotencyKey, second.body.idempotencyKey);
  // UUIDv5 shape: version nibble 5, variant nibble 8/9/a/b.
  assert.match(
    first.body.idempotencyKey,
    /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
  assert.deepEqual(second.body, first.body);
});

test("FORTIFY response never includes action.amount", async () => {
  // Test env params [10,70,...]: selfBalance 60 < 70 -> FORTIFY.
  const envelope = baseEnvelope({
    turn: 3,
    state: { selfBalance: 60, opponentBalance: 100, selfFortifiedUntilTurn: null, opponentFortifiedUntilTurn: null },
    idempotencyKey: "test-key-fortify",
  });
  const { res, body } = await postAgent(envelope);
  assert.equal(res.status, 200);
  assert.equal(body.action.type, "FORTIFY");
  assert.ok(!("amount" in body.action), "amount must be omitted for FORTIFY");
});

test("HOLD response (opponent balance 0) never includes action.amount", async () => {
  // Circuit list: HOLD when opponentBalance <= params[2] (0 here).
  const envelope = baseEnvelope({
    state: { selfBalance: 100, opponentBalance: 0, selfFortifiedUntilTurn: null, opponentFortifiedUntilTurn: null },
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
  assert.equal(body.protocolVersion, "v1");
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

test("strategy: circuit decision list for params [10,70,0,0,0,0,0,0]", () => {
  const ctx = (turn: number, selfBalance: number, opponentBalance: number) => ({
    turn,
    selfBalance,
    opponentBalance,
    selfFortifiedUntilTurn: null,
    opponentFortifiedUntilTurn: null,
  });
  // FORTIFY only below 70; otherwise EXTRACT 10 (opponent above 0).
  assert.deepEqual(decideAction(ctx(19, 90, 100)), { type: "EXTRACT", amount: 10 });
  assert.deepEqual(decideAction(ctx(5, 85, 100)), { type: "EXTRACT", amount: 10 });
  assert.deepEqual(decideAction(ctx(4, 100, 100)), { type: "EXTRACT", amount: 10 });
  assert.deepEqual(decideAction(ctx(3, 60, 100)), { type: "FORTIFY" });
  assert.deepEqual(decideAction(ctx(3, 100, 0)), { type: "HOLD" });
  // Default params [10,0,0,0,0,0,0,0]: always EXTRACT 10, HOLD only at opp 0.
  assert.deepEqual(
    decideActionFromParams(ctx(1, 100, 100), DEFAULT_PARAMS),
    { type: "EXTRACT", amount: 10 },
  );
  assert.deepEqual(
    decideActionFromParams(ctx(1, 100, 0), DEFAULT_PARAMS),
    { type: "HOLD" },
  );
  // params[3] == 1 forces HOLD (unless FORTIFY wins first).
  assert.deepEqual(
    decideActionFromParams(ctx(1, 100, 100), [10, 0, 0, 1, 0, 0, 0, 0]),
    { type: "HOLD" },
  );
  assert.deepEqual(
    decideActionFromParams(ctx(1, 60, 100), [10, 70, 0, 1, 0, 0, 0, 0]),
    { type: "FORTIFY" },
  );
});

test("circuit inputs: all 17 inputs wired for a valid turn", () => {
  const envelope = baseEnvelope({
    strategyCommitment: { hash: testCommitment },
  }) as unknown as TurnEnvelope;
  const inputs = buildCircuitInputs(envelope, { type: "EXTRACT", amount: 10 }, { params: TEST_PARAMS, salt: testSalt });
  assert.deepEqual(Object.keys(inputs).sort(), [
    "action",
    "amount",
    "circuitVersion",
    "commitment",
    "matchId",
    "opponentBalance",
    "salt",
    "selfBalance",
    "strategyParams",
    "turnNumber",
  ]);
  assert.deepEqual(inputs.strategyParams, ["10", "70", "0", "0", "0", "0", "0", "0"]);
  assert.equal(inputs.commitment, BigInt(testCommitment).toString());
  assert.equal(inputs.action, "2");
  assert.equal(inputs.amount, "10");
  assert.equal(inputs.turnNumber, "3");
});

test("circuit inputs: invalid params and missing salt are rejected", () => {
  const envelope = baseEnvelope({
    strategyCommitment: { hash: testCommitment },
  }) as unknown as TurnEnvelope;
  // All-zero params can never prove.
  assert.throws(
    () => buildCircuitInputs(envelope, { type: "EXTRACT", amount: 10 }, { params: [0, 0, 0, 0, 0, 0, 0, 0], salt: testSalt }),
    /STRATEGY_PARAMS\[0\].*1\.\.10/,
  );
  // EXTRACT amount out of range.
  assert.throws(
    () => buildCircuitInputs(envelope, { type: "EXTRACT", amount: 10 }, { params: [11, 0, 0, 0, 0, 0, 0, 0], salt: testSalt }),
    /STRATEGY_PARAMS\[0\].*1\.\.10/,
  );
  // params[4..7] must be exactly 0.
  assert.throws(
    () => buildCircuitInputs(envelope, { type: "EXTRACT", amount: 10 }, { params: [10, 0, 0, 0, 1, 0, 0, 0], salt: testSalt }),
    /STRATEGY_PARAMS\[4\] must be exactly 0/,
  );
  // params[3] must be 0 or 1.
  assert.throws(
    () => buildCircuitInputs(envelope, { type: "EXTRACT", amount: 10 }, { params: [10, 0, 0, 2, 0, 0, 0, 0], salt: testSalt }),
    /STRATEGY_PARAMS\[3\] must be 0 or 1/,
  );
  // Missing salt: no proof can be produced.
  assert.throws(
    () => buildCircuitInputs(envelope, { type: "EXTRACT", amount: 10 }, { params: TEST_PARAMS, salt: "" }),
    (e: unknown) => e instanceof ProofInputsIncompleteError,
  );
  // validateStrategyParams rejects non-arrays and wrong lengths.
  assert.throws(() => validateStrategyParams([10, 0, 0]), /exactly 8 elements/);
  assert.throws(() => validateStrategyParams("not-an-array"), /JSON array of 8 integers/);
});

function proofEnvelope(turn: number, selfBalance: number, opponentBalance: number): TurnEnvelope {
  return {
    protocolVersion: "v1",
    eventId: "steal-the-vfy",
    matchId: MATCH_ID,
    turn,
    issuedAt: new Date().toISOString(),
    deadlineAt: new Date(Date.now() + 60_000).toISOString(),
    state: {
      selfBalance,
      opponentBalance,
      selfFortifiedUntilTurn: null,
      opponentFortifiedUntilTurn: null,
    },
    strategyCommitment: { hash: testCommitment },
  };
}

test("commitment matches the Poseidon spec (golden value from the circuit probe)", async () => {
  // Independent check: params [10,0,0,0,0,0,0,0] + salt 123456789
  // produced 0x0bdd4e... in the /tmp probe against the official circuit.
  const golden = await computeCommitment([10, 0, 0, 0, 0, 0, 0, 0], "0x75bcd15");
  assert.equal(golden, "0x0bdd4ea66acf04d7ef79f45af72b709020c9269b8452dd6cab33355d866126cd");
  // And the runtime commitment used by the proof tests is consistent.
  assert.equal(testCommitment, await computeCommitment(TEST_PARAMS, testSalt));
});

test("proof: EXTRACT 10 proves and self-verifies", async () => {
  const t0 = Date.now();
  const { proof, publicSignals } = await generatePolicyProof(
    proofEnvelope(3, 100, 100),
    { type: "EXTRACT", amount: 10 },
    { params: TEST_PARAMS, salt: testSalt },
  );
  const ms = Date.now() - t0;
  console.log(`  [timing] EXTRACT proof: ${ms}ms`);
  assert.ok(proof, "proof must be present");
  assert.equal(publicSignals.length, 9);
  // Layout: [digest, commitment, matchId, turn, self, opp, action, amount, version].
  assert.equal(publicSignals[1], BigInt(testCommitment).toString());
  assert.equal(publicSignals[3], "3");
  assert.equal(publicSignals[4], "100");
  assert.equal(publicSignals[5], "100");
  assert.equal(publicSignals[6], "2");
  assert.equal(publicSignals[7], "10");
  assert.equal(publicSignals[8], "1");
});

test("proof: HOLD proves and self-verifies", async () => {
  const t0 = Date.now();
  const { proof, publicSignals } = await generatePolicyProof(
    proofEnvelope(4, 100, 0),
    { type: "HOLD" },
    { params: TEST_PARAMS, salt: testSalt },
  );
  const ms = Date.now() - t0;
  console.log(`  [timing] HOLD proof: ${ms}ms`);
  assert.ok(proof, "proof must be present");
  assert.equal(publicSignals.length, 9);
  assert.equal(publicSignals[6], "0");
  assert.equal(publicSignals[7], "0");
});

test("proof: FORTIFY proves and self-verifies with params[1] > 0", async () => {
  const t0 = Date.now();
  const { proof, publicSignals } = await generatePolicyProof(
    proofEnvelope(5, 60, 100),
    { type: "FORTIFY" },
    { params: TEST_PARAMS, salt: testSalt },
  );
  const ms = Date.now() - t0;
  console.log(`  [timing] FORTIFY proof: ${ms}ms`);
  assert.ok(proof, "proof must be present");
  assert.equal(publicSignals.length, 9);
  assert.equal(publicSignals[6], "1");
  assert.equal(publicSignals[7], "0");
});

test("proof: wrong action for the state is unprovable (circuit assert)", async () => {
  // With params [10,70,...] at 100/100 the circuit demands EXTRACT 10;
  // asking it to prove EXTRACT 5 must fail the assert.
  await assert.rejects(
    generatePolicyProof(proofEnvelope(3, 100, 100), { type: "EXTRACT", amount: 5 }, { params: TEST_PARAMS, salt: testSalt }),
  );
  // And HOLD at 100/100 (opponent above 0) is equally unprovable.
  await assert.rejects(
    generatePolicyProof(proofEnvelope(3, 100, 100), { type: "HOLD" }, { params: TEST_PARAMS, salt: testSalt }),
  );
});
