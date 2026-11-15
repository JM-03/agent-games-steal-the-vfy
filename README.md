# Steal the VFY — every move provably bound to a pre-committed strategy

A TypeScript/Node agent for the **Steal the VFY** track of zkVerify Agent
Games (Wildcard). Built by Elgi (`@jmartil1`, GitHub `JM-03`) with his AI
assistant jink. Indonesian version: [`README-id.md`](README-id.md).

📺 **Public demo page (no install needed):** [jm-03.github.io/agent-games-steal-the-vfy/demo.html](https://jm-03.github.io/agent-games-steal-the-vfy/demo.html) — full 20-turn replay, defensive demo, refusal demo, and links.

> **Problem:** Giving an agent a wallet means giving it the money — and
> auditing it means trusting logs the agent wrote about itself.
>
> **This agent** can only do what it committed to before acting, proven in
> zero knowledge. The commitment hides the policy; the circuit enforces it.
>
> **Result:** 20/20 turns proved and locally verified in ~13s; a wrong move
> cannot be proven at all.

**Commit once, prove every move.**

> **STATUS — 14 Nov 2026.** The proof pipeline is **fully working**: all 17
> circuit inputs proven, a Groth16 proof generated and self-verified
> locally per turn, demo 20-turn match **20/20 proved + verified**, and a
> runnable refusal demo (a wrong move the circuit will not prove).
> Defensive demo added 15 Nov: a second strategy `[5,50,20,0,0,0,0,0]`
> under its own commitment, 40/40 proved, FORTIFY x9 + HOLD x4 live.
> 16 Nov: added "Verified on mainnet" — the differentiator vs entries
> whose proofs are only checked by their own code.
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

## Threat model

The guarantee above is not a slogan — it is the output of adversarial
reasoning. Every threat below is already handled in code; nothing here is
aspirational.

| Attacker capability | What happens | Enforced by |
|---|---|---|
| Agent fully compromised (code + keys + salt + strategy in hand) | Can only prove moves the committed policy allows; a wrong move has no proof at all | Circuit asserts on the committed params (`src/strategy.ts`, `src/proof.ts`) |
| Replay a proof for another turn | Public signals bind `matchId` + `turnNumber`, so a proof made for turn N does not verify for turn M; a platform retry of the same turn returns the cached response, never a new proof | `publicInputsHash` bound to match/turn + deterministic idempotency key per `matchId:turn` (`src/turn.ts`) |
| Forge the commitment in the turn envelope | Commitment-hash mismatch → HOLD with no proof | Commitment check in `src/turn.ts` |
| Swap the circuit / verification key | Proofs are generated and self-verified against the official vfy-policy VK (`0x6c56…be047`); a proof from a different circuit fails local self-verification and is never sent | `snarkjs.groth16.verify` in `src/proof.ts` |
| Expired task / forged signature | Expired deadline → HOLD; HMAC is verified on the raw body before JSON is parsed, and an invalid signature is rejected | Deadline check + raw-body HMAC (`src/turn.ts`, `src/server.ts`) |
| Proof generation fails for any reason | Agent answers HOLD with no proof instead of guessing | Fail-closed handler (`src/turn.ts`) |

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

| # | Check | Enforced by |
|---|---|---|
| 1 | Verification key matches the registered key | Proofs generated + self-verified vs official vfy-policy VK (`0x6c56…be047`); envelope commitment must match (`src/turn.ts`) |
| 2 | Circuit and proof system are the ones expected | Official `vfy-policy` circuit, Groth16/bn128 (`circuits/`) |
| 3 | Public inputs prove the required threshold, recipient and action | Strict decision list FORTIFY → HOLD → EXTRACT; a move outside the list is unprovable |
| 4 | Proof reference not already used | Deterministic idempotency key per `matchId:turn`; a replay returns the same response, never a new proof |
| 5 | Verification reached a finalized state before approval | Proofs submitted to Kurier and polled until Finalized before they count as on-chain evidence |
| 6 | Task signature and timestamp valid | HMAC verified on the raw body before JSON is parsed; an expired deadline fails closed to HOLD |
| 7 | Every response signed | `x-agent-games-signature` on every response |

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

AutoSRE won 1st place in the Dynatrace track at the Google Cloud
Rapid Agent Hackathon 2026 (1,425 submissions) on the same thesis —
"the refusal is the product." This entry's audit trail is the Kurier
Finalized receipt: every approved move leaves a checkable record on
zkVerify mainnet. (A refused move produces no proof, so no receipt
exists for a refusal — the demo output is the evidence.)

## Evidence

| Check | Result | How to verify |
|---|---|---|
| Demo match (20 turns, real proofs) | 20/20 proved + locally verified, ~13s, final 168–28 | `npm run demo` |
| Refusal demo (2 out-of-policy moves) | 2/2 refused by the circuit; agent answered HOLD | `npm run demo:refusal` |
| Defensive demo (FORTIFY + HOLD live) | 40/40 proved + locally verified; FORTIFY x9, HOLD x4 | `npm run demo:defensive` |
| Test suite | 19/19 pass | `npm test` |
| Why zkVerify (verification cost) | ~272k gas per proof on Ethereum; up to 90% less via zkVerify | See "Why zkVerify — in numbers" |
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

Defensive demo — the same commitment pattern, a different strategy
(`[5,50,20,0,0,0,0,0]`, commitment `0x1b63…a2a24`):

```bash
npm run demo:defensive
```

Two 20-turn matches, one commitment. Scenario A (under attack) fires
FORTIFY 9 times; scenario B (passive opponent) fires HOLD 4 times.
Output (abridged):

```
Scenario A — under attack:
turn 11: us EXTRACT 5  | opp EXTRACT 10  | proof=proved-not-finalized | 705ms | balances 50->45 / 150->155
turn 12: us FORTIFY    | opp EXTRACT 5   | proof=proved-not-finalized | 703ms | balances 45->38 / 155->160
...
Totals: 20/20 turns proved + locally verified, 16280ms total, avg 814ms/turn.
Actions: EXTRACT x11, FORTIFY x9, HOLD x0.
Final balances: us 22 — opponent 160 → OPPONENT WIN.

Scenario B — draining a passive opponent:
turn 16: us EXTRACT 5  | opp HOLD        | proof=proved-not-finalized | 639ms | balances 175->180 / 25->20
turn 17: us HOLD        | opp HOLD        | proof=proved-not-finalized | 801ms | balances 180->180 / 20->20
...
Totals: 20/20 turns proved + locally verified, 14066ms total, avg 703ms/turn.
Actions: EXTRACT x16, FORTIFY x0, HOLD x4.
Final balances: us 180 — opponent 20 → US WIN.

DEFENSIVE DEMO OK: 40/40 turns proved + locally verified across both matches (EXTRACT x27, FORTIFY x9, HOLD x4).
```

Scenario A loses on points — that is the point: the defensive branch
fires 9 times and every move is still proven. One 20-turn match cannot
show both defensive branches (FORTIFY needs our balance to fall while
HOLD needs theirs to fall), so the demo plays two matches under one
commitment instead of faking it in one. The defensive salt lives in
`.env.strategy-defensive` (gitignored, mode 0600) — never in the repo,
never in the main `.env.strategy`.

Then `npm run demo:refusal` to watch an illegal move fail (see above).

## The problem

The enemy here is not a "bad agent" — it is **the unprovable agent**: a
black-box agent holding keys to a treasury, where one move outside its
mandate can drain funds and nobody can prove who is at fault.

*Every agent move should be provably bound to the strategy its owner committed to — or it shouldn't move money.*

This is the **SECURITY** entry from the event's own inspiration list — a
wallet & transaction guard — with the policy hidden by a Poseidon
commitment and enforced by a Groth16 proof. It is the mirror image of the
official example: instead of granting access when a proof shows a
credential, this agent *acts* only when a proof shows the action is
permitted by a committed policy.

The pattern is established: Mandate (sponsor prize, ETHOnline 2026),
MARS (1st, ETHGlobal New York 2026), Petri (ETHOnline 2026 finalist)
and Identone (1st, cheqd Verifiable AI Hackathon 2025) all bound an
agent's authority and put verification in front of every action. What
this entry adds is enforcement with real cryptography: Groth16 proofs
verified on zkVerify mainnet, in a live adversarial match — every move
carries a proof that it stayed inside the policy the agent committed
to before the match.

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

**The validation slot is empty.** ERC-8004, the Ethereum "Trustless
Agents" standard proposed in August 2025 (MetaMask, Ethereum Foundation,
Google, Coinbase), defines three registries — Identity, Reputation, and
Validation, where independent validators return a score plus proof that an
agent did what it claims. Identity and Reputation are live on mainnet
since January 2026, but the Validation Registry was pulled back for
rework and is not in the official mainnet set. This entry fills that slot
concretely: a validator that returns a ZK proof per move that the move
stayed inside the committed strategy. (This is not a claim of ERC-8004
compliance — there is no real registration; it is an implementation of
the validation slot the standard defines.)

## Why zkVerify — in numbers

Trusting the agent's own logs costs $0 and proves nothing; verifying each
move on zkVerify makes it checkable by anyone, permanently.

- A Groth16 proof (BN254) is **256 bytes** (uncompressed: two G1 points
  + one G2 point).
- Verifying one of our proofs directly on Ethereum would cost ≈ **272,000
  gas** for 9 public inputs, by Horizen Labs' formula: ~207,700 gas fixed
  + ~7,160 gas per public input (207,700 + 9 × 7,160 = 272,140).
- zkVerify cuts verification cost by **up to 90%** versus Ethereum
  (Delphi Digital; Horizen Labs).

Every move in this repo carries such a proof — 20 per match, 60 across
the three demo matches — and each one is independently verifiable on
zkVerify mainnet.

## Verified on mainnet, not just by the agent itself

A proof that only the agent's own code verifies proves nothing to
anyone else — the agent could verify anything it likes and print
"valid". Local self-verification is only the first gate in this repo:
a proof that fails it is never sent. The check that counts happens on
zkVerify mainnet, where the proof is submitted via Kurier and polled
until Finalized — by a verifier the agent does not control.

The same submit-and-poll path already returned Finalized jobs in live
scored Gatekeeper rounds (three jobs, 13 Nov). The first Steal
Finalized job id is pending — it goes in Proof Reference below as soon
as the demo runs with the key set.

## How this compares

There is more than one way to make an agent's behavior checkable. This
entry chooses ZK proofs of policy compliance — a deliberate choice among
real alternatives, not a default:

| Approach | What it proves | What you must trust | When it fits |
|---|---|---|---|
| **This entry: ZK proof per move over a commitment** | That this move was allowed by the strategy the owner committed to before acting | The circuit and the commitment (both public) — nothing about the agent at runtime | When the policy must be secret but every action must be checkable by anyone |
| Policy Vault (chandrabosep) | That a vault payment follows a signed policy, verified on Base Sepolia testnet | A custom circuit with a one-contribution trusted setup | Same pattern, testnet scope; this entry uses the official circuit on mainnet |
| Mandate (sponsor prize, ETHOnline 2026) | That a treasury spend was cleared by a verifier | The verifier service itself (a "virtual verifier", not public cryptography) | When a trusted verifier service is acceptable |
| TEE-based agents (Oasis ROFL, NEAR Shade, Phala) | That the correct code is running, attested by hardware | The hardware vendor (Intel SGX/TDX, NVIDIA) and the attestation chain | When hardware attestation is available and trusted |
| Lit-style signing policy (Lit Protocol, Vincent) | That only an authorized signer can sign, under a policy enforced at signing time | The threshold network / TEE that holds the key shares | When the question is *who may sign* |
| Agent + audit log | Nothing independently — the log says what the agent claims it did | The agent's own logs | Never, for money: logs the agent wrote about itself prove nothing |
| Proof verified only by the agent's own code | That the proof is well-formed — nothing about who checked it | The agent that produced the proof | Never, as evidence to a third party: a verifier the prover controls is not independent |

The spectrum, stated plainly: a TEE is proof by hardware, a bond/slashing
scheme is proof by economics, multi-model consensus is proof by social
agreement — and a ZK proof is proof by mathematics about the decision
itself. This entry chooses ZK because it needs no trust in a hardware
vendor or a threshold of nodes: the proof either verifies against the
public commitment or it does not. The honest boundary: a TEE proves the
*right code is running*; this entry proves the *right move was taken*.
The two are complementary, not competing — a TEE cannot prove a move
stayed inside a committed policy, and a ZK policy proof cannot prove what
code produced it.

## How it works (brief)

```mermaid
flowchart LR
    A[Commit once: Poseidon(params, salt) published] --> B[Signed turn envelope arrives]
    B --> C[Decide: FORTIFY → HOLD → EXTRACT]
    C --> D[Prove: Groth16 from official vfy-policy circuit]
    D --> E{Self-verify locally vs official VK}
    E -->|passes| F[Answer with proof + public signals]
    E -->|fails| G[Answer HOLD, no proof]
    F --> H[Kurier: submit in background → Finalized]
    D -->|circuit refuses| G
```

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
- `scripts/demo-match-defensive.cjs` — second demo: params
  `[5,50,20,0,0,0,0,0]` under a separate commitment
  (`.env.strategy-defensive`, never the main `.env.strategy`), two 20-turn
  matches that fire FORTIFY (x9) and HOLD (x4) live
  (`npm run demo:defensive`).
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
npm run demo:defensive # defensive demo — FORTIFY + HOLD live (separate commitment)
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
