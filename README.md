# Steal the VFY — every move provably bound to a pre-committed strategy

A TypeScript/Node agent for the **Steal the VFY** track of zkVerify Agent
Games (Wildcard). Built by Elgi (`@jmartil1`, GitHub `JM-03`) with his AI
assistant jink. Indonesian version: [`README-id.md`](README-id.md).

> **Problem:** Giving an agent a wallet means giving it the money — and
> auditing it means trusting logs the agent wrote about itself.
>
> **This agent** can only do what it committed to before acting, proven in
> zero knowledge. The commitment hides the policy; the circuit enforces it.
>
> **Result:** 20/20 turns proved and locally verified in ~13s; a wrong move
> cannot be proven at all.

> **STATUS — 14 Nov 2026.** The proof pipeline is **fully working**: all 17
> circuit inputs proven, a Groth16 proof generated and self-verified
> locally per turn, demo 20-turn match **20/20 proved + verified**, and a
> runnable refusal demo (a wrong move the circuit will not prove).
> The Steal tournament is **locked** (8 agents paired, Round 1 running
> 13–17 Nov) — so this repo is submitted as a **Wildcard** entry: a runnable
> demo + real proofs as evidence, not a tournament participant.

## The guarantee (even if the agent is fully compromised)

The guarantee holds even if the agent is fully compromised. With the
agent's code, keys, salt and strategy in hand, an attacker can still only
prove moves the committed policy allows. A wrong move cannot be proven at
all — the circuit refuses — and without a proof the platform rejects the
move.

A fully compromised agent can extract at most 10 VFY per turn, and only
when the committed strategy allows it — it cannot invent a move, change
the strategy mid-match, or reuse a proof.

## What is checkable, by whom

| Claim | Who can check it | How |
|---|---|---|
| Every move the agent made was allowed by the committed strategy | Anyone | Each turn's proof + public signals verify against the official vfy-policy circuit; proofs are on zkVerify mainnet via Kurier |
| The strategy hasn't changed mid-match | Anyone | The commitment is a public input to every proof; a new strategy needs a new commitment |
| A specific move matches a specific strategy | Anyone the owner shows the strategy to | Recompute the commitment off chain (`scripts/commitment.cjs`) |
| The strategy itself | Nobody but the owner | Only the Poseidon commitment is ever published |
| The agent cannot invent a move, reuse a proof, or act twice on one turn | Anyone | Circuit asserts + `publicInputsHash` bound to match/turn + deterministic idempotency key per turn |

## What we check before acting

zkVerify's own /build page puts it this way: *"A proof can verify
perfectly and still authorize the wrong action. Your agent must confirm
what was proven, not only whether verification succeeded."*
("Verification is necessary, not sufficient.")

Before acting, this agent checks what the proof proves — the same
seven checks the /build page requires, mapped to how this repo enforces
them:

1. **The verification key matches the registered key** — proofs are
   generated and self-verified against the official vfy-policy
   verification key (`0x6c56…be047`), and the turn envelope's
   commitment hash must match the committed strategy (`src/turn.ts`).
2. **The circuit and proof system are the ones expected** — the
   official `vfy-policy` circuit, Groth16/bn128, from the official
   site (`circuits/`).
3. **The public inputs prove the required threshold, recipient and
   action** — the agent decides strictly by the circuit's decision
   list (FORTIFY → HOLD → EXTRACT); a move outside the list is
   unprovable.
4. **The proof reference has not already been used** — a
   deterministic idempotency key per `matchId:turn`; a replayed turn
   returns the same response, never a new proof.
5. **The verification reached a finalized state before approval** —
   proofs are submitted to Kurier and polled until Finalized before
   they count as on-chain evidence.
6. **The task signature and timestamp are valid** — HMAC is verified
   on the raw body before JSON is parsed; an expired deadline fails
   closed to HOLD.
7. **Every response is signed** — `x-agent-games-signature` on every
   response.

## The refusal test — watch the agent try to cheat and fail

```bash
npm run demo:refusal
```

The demo attempts two out-of-policy moves against the real committed
strategy and the real circuit, then shows what the agent actually does.
Output (abridged):

```
ATTEMPT 1: prove EXTRACT 11 (committed cap is 10) ...
  CIRCUIT REFUSED: Error: Assert Failed. Error in template VfyPolicyProof_154 line: 149
  -> No proof exists for this move. Nothing to send, nothing to verify.

ATTEMPT 2: prove EXTRACT 10 when opponent balance is 0 (strategy says HOLD) ...
  CIRCUIT REFUSED: Error: Assert Failed. Error in template VfyPolicyProof_154 line: 140
  -> No proof exists for this move. Nothing to send, nothing to verify.

AGENT ANSWER for that same turn (turn 2, opponent balance 0):
  action: HOLD  | proof: yes (valid, self-verified)  | proofStatus: proved-not-finalized
  -> The agent never sends the refused move. It answers the in-policy action (HOLD) and proves that one instead.

FAIL-CLOSED: turn envelope with a tampered commitment hash ...
  action: HOLD  | proof: no  | proofStatus: no-proof
  -> The agent answers HOLD with no proof instead of guessing or sending an unproven move.

REFUSAL DEMO OK: 2/2 out-of-policy moves refused by the circuit, agent answered HOLD in both fail-closed cases.
```

Verification is the gate, not a badge: without the proof, the move does
not happen.

The same thesis won 1st place in the Dynatrace track at the Google
Cloud Rapid Agent Hackathon 2026 (1,425 submissions): AutoSRE, an
agent that physically cannot act without approval — "the refusal is
the product" — with every approval and refusal in an append-only
audit trail. This entry's audit trail is the Kurier Finalized
receipt: every approved move leaves a checkable record on zkVerify
mainnet. (A refused move produces no proof to submit, so no Kurier
receipt exists for a refusal — the refusal demo's own output is the
evidence.)

## Evidence

| Check | Result | How to verify |
|---|---|---|
| Demo match (20 turns, real proofs) | 20/20 proved + locally verified, ~13s, final 168–28 | `npm run demo` |
| Refusal demo (2 out-of-policy moves) | 2/2 refused by the circuit; agent answered HOLD | `npm run demo:refusal` |
| Test suite | 19/19 pass | `npm test` |
| Kurier Finalized job (one proof from the demo) | *pending — run the demo with `KURIER_API_KEY` set; the job id goes in Proof Reference below* | `npm run demo` with the key set |
| Live endpoint | `https://agent-games-steal-the-vfy-production.up.railway.app/agent` — preflight + signed turns; unsigned requests are rejected with 401 (correct fail-closed behavior) | `curl .../health` |

## Try it in 60 seconds

```bash
npm install
npm run build
npm run demo
```

```
turn  1: us EXTRACT 10  | opp EXTRACT 5   | proof=proved-not-finalized | 1325ms | balances 100->105 / 100->95
turn  2: us EXTRACT 10  | opp EXTRACT 5   | proof=proved-not-finalized | 626ms | balances 105->110 / 95->90
turn  3: us EXTRACT 10  | opp EXTRACT 5   | proof=proved-not-finalized | 707ms | balances 110->115 / 90->85
...
Totals: 20/20 turns proved + locally verified, 12608ms total, avg 630ms/turn.
Final balances: us 168 — opponent 28 → US WIN.
```

Then `npm run demo:refusal` to watch an illegal move fail (see above).

## The problem

This is the **SECURITY** entry from the event's own inspiration list — a
wallet & transaction guard — with the policy hidden by a Poseidon
commitment and enforced by a Groth16 proof. It is the mirror image of the
official example: instead of granting access when a proof shows a
credential, this agent *acts* only when a proof shows the action is
permitted by a committed policy.

The same pattern keeps winning elsewhere: Mandate (sponsor prize,
ETHOnline 2026), MARS (1st, ETHGlobal New York 2026), Petri
(ETHOnline 2026 finalist), Identone (1st, cheqd Verifiable AI
Hackathon 2025) — bounded authority with verification as the gate.

The game is the hardest possible test of the pattern: an adversarial
opponent, a public commitment, and a referee that cannot be bribed — if
the agent can be proven honest here, the same proof works for a trading
limit or a treasury.

**Beyond the game:** the pattern is general — any agent whose actions must
be provably bound to a policy it committed to before acting (a trading bot
capped at a loss limit, a governance agent bound to a voted mandate, a
wallet guard bound to an allowlist) can commit to its policy with a
Poseidon hash and prove every action against the official circuit, without
revealing the policy itself.

## How it works (brief)

1. Before a match, the owner picks 8 strategy numbers (`strategyParams`)
   and a random salt, then computes
   `commitment = Poseidon(strategyParams[0..7], salt)`.
   Only the commitment (hash) is published — params and salt stay secret.
2. Each turn, the platform sends a signed envelope (both balances,
   commitment hash, ~30s deadline).
3. The agent decides the action **exactly following the circuit's decision
   list** (strict priority: FORTIFY → HOLD → EXTRACT), generates a Groth16
   proof from the official `vfy-policy` circuit, then **self-verifies that
   proof locally** before answering. A proof that fails local verification
   is never sent.
4. Turn answer: action + `publicInputsHash` + proof + `public_signals`,
   all HMAC-signed. If a proof cannot be made, the agent still answers
   action + hash **without a proof** (the platform scores that as HOLD) —
   the server never crashes.
5. The proof is also submitted to **Kurier** (VK registered first at server
   start) and polled until Finalized.

Strategy semantics (proven by probing the official circuit, see
`CIRCUIT_NOTES.md`):

| Param | Meaning |
|---|---|
| `[0]` | EXTRACT amount, 1–10 |
| `[1]` | FORTIFY threshold: FORTIFY when selfBalance < `[1]` |
| `[2]` | HOLD threshold: HOLD when opponentBalance ≤ `[2]` |
| `[3]` | 0/1 — if 1, always HOLD (except FORTIFY) |
| `[4..7]` | Must be 0 |

Default params: **`[10,0,0,0,0,0,0,0]`** — always EXTRACT 10. The
simplest provable strategy; not a claim of a winning strategy.

## What's in this repo

- `src/server.ts` — `GET /health`, `POST /agent` (preflight + turn).
  HMAC is verified from the **raw body** before JSON is parsed; every
  response is signed (`x-agent-games-signature`). At start, the VK is
  registered with Kurier in the background (fire-and-forget, never crashes
  the server).
- `src/turn.ts` — envelope validation, deadline check, commitment-hash
  check, deterministic idempotency **UUIDv5-style from `matchId:turn`**
  (a platform retry returns the same response; a new turn never reuses a
  key), and **fail-safe to HOLD** on any error/uncertainty.
  `action.amount` is **never** sent for HOLD/FORTIFY.
- `src/strategy.ts` — the circuit's decision list (`decideActionFromParams`).
- `src/strategyParams.ts` — params validation (rejects `[0]` outside 1–10,
  `[3]` not 0/1, `[4..7]` not 0; all-zero params rejected).
- `src/poseidon.ts` — Poseidon via circomlibjs, `computeCommitment`.
- `src/circuitInputs.ts` — all **17 circuit inputs** wired
  (9 scalars + `strategyParams[0..7]` + salt).
- `src/proof.ts` — `generatePolicyProof()` (snarkjs fullProve + local
  self-verify against the official verification key),
  `registerKurierVk()`, `submitProofToKurier()`, `pollKurierJob()`
  (correct endpoint: `GET /job-status/{KEY}/{jobId}`).
- `src/publicInputsHash.ts` — exactly per the official snippet (keccak256
  over 8 fields, each 32 bytes big-endian).
- `circuits/` — the **original** circuit files from the official site
  (`vfy-policy.wasm`, `vfy-policy_final.zkey`, `circuit-info.json`).
  vk_hash: `0x6c56509f1c56fd1fd4e9737f906d2220f4b95f1d507f1adf6899085bd74be047`
- `scripts/commitment.cjs` — generates a fresh random salt, computes the
  commitment, saves it to `.env.strategy` (mode 0600, gitignored, salt
  **never printed**), then checks a proof for each reachable branch.
- `scripts/demo-match.cjs` — simulates a 20-turn match against a scripted
  opponent, real proof per turn, per-turn summary + totals. If
  `KURIER_API_KEY` is set, submits ONE proof to Kurier.
- `scripts/demo-refusal.cjs` — the refusal demo: two out-of-policy moves
  the circuit will not prove, plus the agent failing closed to HOLD
  (`npm run demo:refusal`).
- `scripts/probe-circuit-inputs.cjs` — circuit-input probing tool (used
  during research; semantics solved, see `CIRCUIT_NOTES.md`).

## Run it / Deploy

```bash
npm install
cp .env.example .env   # fill AGENT_GAMES_HMAC_SECRET first
npm run commitment     # generate salt + commitment, writes .env.strategy
npm test               # 19 tests, all must pass
npm run demo           # 20-turn match (no Kurier unless KURIER_API_KEY is set)
npm run demo:refusal   # the refusal demo
npm run build
npm start              # runs at http://localhost:3000
```

Health check: `curl http://localhost:3000/health`

Latest results (14 Nov 2026): **19 tests pass, 0 fail** — health, signed
preflight, rejection of bad/unsigned signatures, valid turn (EXTRACT 10 +
matching `publicInputsHash`), replayed `idempotencyKey` returning an
identical response, deterministic UUIDv5 key, FORTIFY/HOLD without
`amount`, expired deadline → HOLD, commitment-hash mismatch → HOLD,
circuit decision-list rules, 17 inputs wired, invalid params rejected,
commitment matching the golden value from the circuit probe, EXTRACT/HOLD/
FORTIFY proofs that prove + self-verify, and a wrong action for the state
being **unprovable** (circuit assert refuses).

Proof generation per turn (local): ~0.5–0.7s steady-state (first turn
~1.3s, cold start). Demo 20 turns: 20/20 proved + verified, 12.6s total
(avg 630ms/turn), final simulated score 168–28 (win vs scripted opponent).

Note: `npm test` uses `--test-force-exit` because snarkjs leaves worker
MessagePorts open after `fullProve`, so the Node process does not exit by
itself. This is only a test-runner issue — the production server runs
continuously by design.

**Deploy (Railway):** Dockerfile-based. Set these Variables in Railway
(enter real values in Railway only, never in chat):
`AGENT_GAMES_HMAC_SECRET` (from the Agent Games dashboard),
`KURIER_API_KEY` (Kurier mainnet API key), `STRATEGY_PARAMS`
(`[10,0,0,0,0,0,0,0]`), `STRATEGY_SALT` (from `.env.strategy`),
`STRATEGY_COMMITMENT_HASH` (from `.env.strategy` —
`0x0b9f4672eb0b10bba098b648216126cb6256f43b0879833483b7f4631f61cb39`
for the default params + the salt generated 14 Nov 2026),
`CIRCUIT_VERSION=v1`, `PROOF_ENABLED=true`.
After changing Variables, click "Apply change" → Deploy — Railway does
not auto-deploy env-var changes.
Public endpoint: `https://agent-games-steal-the-vfy-production.up.railway.app/agent`
(register the full handler path).

## Honest limits

- **The Steal tournament is locked** — this entry is a demo + proofs for
  Wildcard, not a tournament participant.
- **The strategy is fixed by the circuit's decision list** — the agent
  cannot use a free-form strategy (e.g. reacting to opponent history);
  only the 8 `strategyParams` numbers can change, and every change needs
  a new commitment.
- **All-zero params cannot be proven** (`params[0]=0` violates the
  circuit's range assert).
- **The circuit digest** (`publicSignals[0]`) is an internal circuit
  value, not `publicInputsHash` — correct inputs ⇒ correct digest;
  nothing to do.
- Idempotency is stored in an **in-memory Map** (`src/turn.ts`) — lost on
  server restart/redeploy. For production, use a persistent store
  (SQLite/Postgres).
- **Dockerfile proven to build on Railway** — deployment 14 Nov 2026
  (552675ed) built from this Dockerfile and runs.

## Security

- Never send a seed phrase / private key / API key / HMAC secret / salt
  via chat or to an AI model. All secrets go through environment variables
  (`.env` / `.env.strategy` locally, Variables in Railway).
- Never commit `.env` / `.env.strategy`. Never log any secret.
- Manual play is forbidden by the official rules: the agent must answer
  automatically.
- One competition account per person/team, one GitHub per competition
  account.

## Proof reference (placeholder for the Wildcard submission)

- Repo: https://github.com/JM-03/agent-games-steal-the-vfy
- Demo endpoint: `https://agent-games-steal-the-vfy-production.up.railway.app/agent`
- Circuit vk_hash: `0x6c56509f1c56fd1fd4e9737f906d2220f4b95f1d507f1adf6899085bd74be047`
- Commitment (params `[10,0,0,0,0,0,0,0]`): `0x0b9f4672eb0b10bba098b648216126cb6256f43b0879833483b7f4631f61cb39`
- Kurier job id (one proof from the demo, after KURIER_API_KEY is set):
  *(fill in after the demo with the key is run — see demo log)*
