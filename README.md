# Steal the VFY — every move provably bound to a pre-committed strategy

A TypeScript/Node agent for the **Steal the VFY** track of zkVerify Agent
Games (Wildcard). Built by Gogo Maduro (`@jmartil1`, GitHub `JM-03`) with jink.

**Commit once, prove every move.**

| | |
|---|---|
| Try the demo (no install) | [demo page](https://jm-03.github.io/agent-games-steal-the-vfy/demo.html) — try to cheat it yourself, 20-turn replay, treasury guard, refusal demo |
| Verify one real proof (no repo code) | `npm run verify:proof` — one turn-1 proof vs the official VK (`evidence/proof-turn-1/`) |
| Watch it try to cheat | `npm run demo:refusal` — 3/3 out-of-policy moves refused by the circuit |
| Watch the demo video | [demo-video.mp4](docs/demo-video.mp4) — 84 s: 20-turn match 20/20 proved, US WIN 168–28, plus the 3/3 refusal demo |
| Public share (bonus) | [X post, 17 Nov 2026](https://x.com/Jmartil1/status/2122677411565465703) — demo video + repo link, #AgentGames @ZKVProtocol |
| Live endpoint | `https://agent-games-steal-the-vfy-production-a1295e30.up.railway.app/agent` (401 without signature = fail-closed) |
| The write-up | [`WRITEUP.md`](WRITEUP.md) — the argument in 1,234 words |

## TL;DR

- **Problem:** an agent with a wallet can move money nobody can audit — its own logs prove nothing.
- **This entry:** every move is proven, in zero knowledge, to stay inside a strategy committed to before acting.
- **Proof:** Groth16 per move over the official `vfy-policy` circuit, verified on zkVerify mainnet via Kurier — a wrong move has no proof at all; the circuit refuses and the agent answers HOLD.
- **Evidence:** 20/20 demo turns proved, 40/40 defensive, 3/3 refusals, treasury guard 3/3, 24/24 tests — all reproducible with one command.
- **Try it:** `npm run demo` — or verify one real proof with `npm run verify:proof`, no repo code needed.
- **Limits:** Steal tournament locked (Wildcard demo); Kurier Finalized job `2d523ed8-e255-11f1-838e-1e6a0d14f999` (17 Nov 2026).

## Status

Shipped: proof pipeline (17/17 inputs, Groth16 per turn, self-verified), demo 20/20, defensive 40/40, refusal 3/3, attack script 5/5, 24/24 tests, public demo page.
Kurier: first Steal Finalized job id `2d523ed8-e255-11f1-838e-1e6a0d14f999` (demo fresh 17 Nov 2026, 20/20, Finalized).
Tournament: Steal entries locked — this is a Wildcard demo, not a tournament entry.

The enemy here is not a "bad agent" — it is **the unprovable agent**: a black-box agent holding keys to a treasury, where one move outside its mandate can drain funds and nobody can prove who is at fault.

It has already happened, in public: **Freysa (Nov 2024)** — an AI agent guarding a prize pool on Base, with one rule ("never transfer funds under any circumstances") — was talked into calling `approveTransfer` and sent the whole ~**$47,000** pool to a participant on the 482nd attempt (195 participants; reported by Cointelegraph and The Block, 29 Nov 2024). The agent was not hacked. It was persuaded.

A rule written in a prompt is not a boundary — a boundary is something the agent *cannot* cross, even when it wants to. That is what a circuit is for.

## Try it — one command

```bash
npm install && npm run build && npm run demo
# 20/20 turns proved + locally verified, ~13s, final 168–28
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
Scenario A — under attack: 20/20 proved, EXTRACT x11, FORTIFY x9, HOLD x0. Final: us 22 — opponent 160 → OPPONENT WIN.
Scenario B — draining a passive opponent: 20/20 proved, EXTRACT x16, FORTIFY x0, HOLD x4. Final: us 180 — opponent 20 → US WIN.
DEFENSIVE DEMO OK: 40/40 turns proved + locally verified across both matches (EXTRACT x27, FORTIFY x9, HOLD x4).
```

Scenario A loses on points — that is the point: the defensive branch
fires 9 times and every move is still proven. One 20-turn match cannot
show both defensive branches (FORTIFY needs our balance to fall while
HOLD needs theirs to fall), so the demo plays two matches under one
commitment instead of faking it in one. The defensive salt lives in
`.env.strategy-defensive` (gitignored, mode 0600) — never in the repo,
never in the main `.env.strategy`.

Then `npm run demo:refusal` to watch an illegal move fail (see below).

Or watch the 84-second demo video: [▶ Watch the demo video (84 s)](docs/demo-video.mp4)

> Note: the video was recorded without a Kurier key, so the Kurier step is skipped in the video by design. The on-chain proof comes from a separate keyed run of the same demo — job `2d523ed8-e255-11f1-838e-1e6a0d14f999`, status Finalized (see "Verified on mainnet" below).

## Evidence

Every number on this page is reproducible with one command (`npm run demo` / `npm test`).

| Check | Result | How to verify |
|---|---|---|
| Demo video (84 s) | 20-turn match 20/20 proved, US WIN 168–28, plus the 3/3 refusal demo | [docs/demo-video.mp4](docs/demo-video.mp4) |
| Demo match (20 turns, real proofs) | 20/20 proved + locally verified, ~13s, final 168–28 | `npm run demo` |
| Refusal demo (3 out-of-policy moves) | 3/3 refused by the circuit; agent answered HOLD | `npm run demo:refusal` |
| Defensive demo (FORTIFY + HOLD live) | 40/40 proved + locally verified; FORTIFY x9, HOLD x4 | `npm run demo:defensive` |
| Test suite | 24/24 pass | `npm test` |
| Independent proof check (zero repo code) | snarkJS OK — one real turn-1 proof verifies against the official VK | `npm run verify:proof` |
| Treasury guard demo (3 examples) | 3/3 behaved as committed (1 refused, 1 proved, 1 allowlist-rejected) | `npm run demo:treasury` |
| Attack script (5 attacks) | 5/5 blocked (tampered commitment, replay, strategy swap, forged proof, unsigned envelope) | `npm run attack` |
| Demo strategy reveal | Recomputed commitment MATCHES the published one | `npm run reveal:demo` |
| Why zkVerify (verification cost) | ~272k gas per proof on Ethereum; up to 90% less via zkVerify | See "Why zkVerify — in numbers" |
| Kurier Finalized job (one proof from the demo) | Finalized — job `2d523ed8-e255-11f1-838e-1e6a0d14f999` (17 Nov 2026, demo 20/20) | `npm run demo` with the key set |
| Live endpoint | `https://agent-games-steal-the-vfy-production-a1295e30.up.railway.app/agent` — preflight + signed turns; unsigned requests are rejected with 401 (correct fail-closed behavior) | `curl .../health` |
| Live proof on demand | `GET /demo-turn` returns one fresh real proof (turn 1, EXTRACT 10, self-verified) — no key, no signature needed | `curl https://agent-games-steal-the-vfy-production-a1295e30.up.railway.app/demo-turn` |
| Treasury check | `POST /treasury/check` answers a real spend request with a verdict + a real proof when allowed (SAFE / REFUSED / REJECTED / HELD) | `curl -X POST .../treasury/check -d '{"amount":5,"recipient":"0x1111111111111111111111111111111111111111"}'` |
| Kurier job status | `GET /proof-status/<jobId>` reads a Kurier job through the server (key stays server-side) | `curl .../proof-status/2d523ed8-e255-11f1-838e-1e6a0d14f999` |
| Public share | X post with the demo video + repo link, #AgentGames @ZKVProtocol | [x.com/Jmartil1/status/2122677411565465703](https://x.com/Jmartil1/status/2122677411565465703) |

## The refusal test — watch the agent try to cheat and fail

```bash
npm run demo:refusal
```

The demo attempts three out-of-policy moves against the real committed
strategy and the real circuit, then shows what the agent actually does.
Output (abridged):

```
ATTEMPT 1: prove EXTRACT 11 (committed cap is 10) ...
  CIRCUIT REFUSED: Error: Assert Failed. Error in template VfyPolicyProof_154 line: 149
  -> No proof exists for this move. Nothing to send, nothing to verify.

ATTEMPT 2: prove EXTRACT 10 when opponent balance is 0 (strategy says HOLD) ...
  CIRCUIT REFUSED: Error: Assert Failed. Error in template VfyPolicyProof_154 line: 140
  -> No proof exists for this move. Nothing to send, nothing to verify.

ATTEMPT 3: replay turn 1's valid proof as turn 2's proof ...
  turn 1 proof vs turn 1 signals: valid
  turn 2 proof vs turn 2 signals: valid
  turn 1 proof vs turn 2 signals: INVALID — replay rejected
  -> Public signals bind matchId + turnNumber, so a proof made for turn N does not verify for turn M.

RETRY: same turn 1 envelope sent twice (platform retry) ...
  identical response: yes  | idempotencyKey: 8f1fe0e2-9b28-5a2f-b58a-cfa570da0930
  -> A retry returns the cached response. The agent never proves the same turn twice.

AGENT ANSWER for that same turn (turn 2, opponent balance 0):
  action: HOLD  | proof: yes (valid, self-verified)  | proofStatus: proved-not-finalized
  -> The agent never sends the refused move. It answers the in-policy action (HOLD) and proves that one instead.

FAIL-CLOSED: turn envelope with a tampered commitment hash ...
  action: HOLD  | proof: no  | proofStatus: no-proof
  -> The agent answers HOLD with no proof instead of guessing or sending an unproven move.

REFUSAL DEMO OK: 3/3 out-of-policy moves refused by the circuit (over-cap, wrong-branch, replay), agent answered HOLD in both fail-closed cases.
```

Verification is the gate, not a badge: without the proof, the move does
not happen.

AutoSRE won 1st place in the Dynatrace track at the Google Cloud
Rapid Agent Hackathon 2026 (1,425 submissions) on the same thesis —
"the refusal is the product." This entry's audit trail is the Kurier
Finalized receipt: every approved move leaves a checkable record on
zkVerify mainnet. (A refused move produces no proof, so no receipt
exists for a refusal — the demo output is the evidence.)

## The problem

*Every agent move should be provably bound to the strategy its owner committed to — or it shouldn't move money.*

This is the **SECURITY** entry from the event's own inspiration list — a wallet & transaction guard — with the policy hidden by a Poseidon commitment and enforced by a Groth16 proof. It is the mirror image of the official example: instead of granting access when a proof shows a credential, this agent *acts* only when a proof shows the action is permitted by a committed policy.

The pattern is established: Mandate (sponsor prize, ETHOnline 2026), MARS (1st, ETHGlobal New York 2026), Petri (ETHOnline 2026 finalist) and Identone (1st, cheqd Verifiable AI Hackathon 2025) all bound an agent's authority and put verification in front of every action. What this entry adds is enforcement with real cryptography: Groth16 proofs verified on zkVerify mainnet, in a live adversarial match — and the game is the hardest possible test of the pattern: an adversarial opponent, a public commitment, and a referee that cannot be bribed. Beyond the game, the same proof works for any agent whose actions must be provably bound to a policy — a trading bot capped at a loss limit, a governance agent bound to a voted mandate, a wallet guard bound to an allowlist.

**The validation slot is empty.** ERC-8004, the Ethereum "Trustless Agents" standard proposed in August 2025 (MetaMask, Ethereum Foundation, Google, Coinbase), defines three registries — Identity, Reputation, and Validation, where independent validators return a score plus proof that an agent did what it claims. Identity and Reputation are live on mainnet since January 2026, but the Validation Registry was pulled back for rework and is not in the official mainnet set. This entry fills that slot concretely: a validator that returns a ZK proof per move that the move stayed inside the committed strategy. (This is not a claim of ERC-8004 compliance — there is no real registration; it is an implementation of the validation slot the standard defines.)

## What is guaranteed, and what enforces it

Even with the agent's code, keys, salt and strategy in hand, an attacker can still only prove moves the committed policy allows. A fully compromised agent can extract at most 10 VFY per turn, and only when the committed strategy allows it — it cannot invent a move, change the strategy mid-match, or reuse a proof.

zkVerify's own /build page puts it this way: *"A proof can verify perfectly and still authorize the wrong action. Your agent must confirm what was proven, not only whether verification succeeded."* ("Verification is necessary, not sufficient.") Before acting, this agent checks what the proof proves — the same seven checks the /build page requires:

| Guarantee | Enforced by |
|---|---|
| A compromised agent can only prove moves the committed policy allows | Circuit asserts on the committed params and the strict decision list (FORTIFY → HOLD → EXTRACT); a move outside the list has no proof at all |
| A proof cannot be reused for another turn | Public signals bind `matchId` + `turnNumber`; a platform retry returns the cached response via a deterministic idempotency key |
| A forged commitment in the envelope is refused | Commitment-hash mismatch → HOLD with no proof |
| A proof from a swapped circuit or key is never sent | Proofs are generated and self-verified against the official vfy-policy circuit (Groth16/bn128), VK `0x6c56…be047`; anything else fails local verification |
| An expired task or forged signature is refused | HMAC verified on the raw body before JSON is parsed; an expired deadline fails closed to HOLD |
| A failed proof means no move | The agent answers HOLD with no proof instead of guessing |
| Every move is checkable by anyone — and the strategy stays secret | Each proof + public signals verify against the official circuit; proofs are submitted to Kurier and polled until Finalized before they count as on-chain evidence; the commitment is a public input to every proof, and only the Poseidon commitment is ever published — a judge shown the strategy can recompute it |
| Every response is signed | `x-agent-games-signature` on every response |

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
Finalized job id is `2d523ed8-e255-11f1-838e-1e6a0d14f999` — demo fresh
17 Nov 2026 (20/20, US WIN 168–28), polled until Finalized:
`Kurier job submitted, jobId=2d523ed8-e255-11f1-838e-1e6a0d14f999, status=Submitted`
`Kurier job 2d523ed8-e255-11f1-838e-1e6a0d14f999 final status: Finalized`

On-chain: [Subscan extrinsic `0xf73f1c21…`](https://zkverify.subscan.io/extrinsic/0xf73f1c21c0401880ea43a08280106626568c275ab3212bf32d4ffa74c6de3c9b)
(txHash `0xf73f1c21c0401880ea43a08280106626568c275ab3212bf32d4ffa74c6de3c9b`).
The live endpoint reports the same receipt at `GET /demo` (`kurier`) and
reads any Kurier job at `GET /proof-status/<jobId>`.

**Our server alone can never produce VERIFIED — only Kurier / zkVerify
mainnet can.** That is the point of the committed proof artifacts: one
real proof, exported so anyone can check it without running a line of
this repo's code — `npm run verify:proof` (see
`evidence/proof-turn-1/README.md`).

## What this does not prove

Honesty about the boundary is part of the entry (the pattern comes from
Petri, ETHOnline 2026 finalist). A proof is a precise statement — here
is what it is not:

- **A Kurier Finalized job proves the proof verified — not that the
  strategy is wise.** EXTRACT 10 every turn is a terrible treasury
  policy and a perfectly provable one. Verification checks compliance
  with the commitment, never the quality of the policy.
- **Local self-verification proves the proof is well-formed — not that
  the check is independent.** A verifier the prover controls is not
  independent; independence comes only from Kurier / zkVerify mainnet.
  That is why the Finalized receipt matters — and the Steal job id is now
  Finalized (see "Verified on mainnet" above).
- **A demo match proves the mechanism — not that EXTRACT 10 wins
  real games.** The demo is a local simulation against a scripted
  opponent; the proofs are real, the score is not a tournament result.
  The defensive demo even loses one match on points (22–160) — on
  purpose: the branches matter, not the score.
- **The commitment hides the strategy from the judges — they can only
  verify it by recompute.** Nobody can read the policy from the
  commitment; a judge who is shown the strategy can recompute it
  (`scripts/commitment.cjs` for the shape, `scripts/reveal-demo.cjs`
  for the demo strategy) and confirm it matches. Privacy and
  checkability are both real, and they trade off exactly here.
- **A proof proves this move followed the policy — not that the policy
  covers every risk.** The circuit knows balances and caps; it does not
  know addresses, counterparties, or market prices. An allowlist check
  lives in the guard layer, not in the circuit — the demo page labels
  which is which.

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
| tiny-chess (Uton10/tiny-chess-agent) | That a chess move is bound to a pre-committed step (commit-then-reveal) | A custom circuit with a demo-grade setup; the proof binds the move, not whether the move is legal or the engine's output | A general pattern (commit-then-reveal) we borrow for the demo reveal; but its Kurier claim is a literal placeholder (`PROOF_REFERENCE`), it has no live demo and no tests |
| Whale Sentinel (whale99999/agent-games-agent) | That a Steal move follows the same `[10,0,0,0,0,0,0,0]` strategy, official circuits for Gatekeeper + Steal | The agent's own code only — no Kurier, no demo page, no refusal demo, no write-up; tests use a dummy VK (`0xaaaa…`) | Same strategy, thinner evidence: this entry adds the Kurier pipeline, the refusal + attack demos, and the public demo page |
| ClaimGuard (jeffmarket12/claimguard) | That a BSC free-mint claim preview was clean — checked by its own gate code, not by a proof | The gate code and the RPC responses it acted on; its README states: "No proof exists. Nothing here is verified on zkVerify today" | A real guard with honest evidence (4/4 dry runs, 14 tests) — but verification is still a design; this entry's proofs are real Groth16 proofs over the official circuit |
| Camotir7f's Steal agent (Camotir7f/steal-the-vfy-agent) | That a Steal turn follows a pre-committed strategy — same official circuit, proof nested in `policyProof` | The agent's own code only — 35 tests, but the strategy is still a TODO placeholder (all-zero params, which the circuit refuses to prove) and Kurier is testnet in its deploy guide | The closest technical parallel — same proof shape, no committed strategy yet; this entry commits to a real strategy and runs it (demo 20/20, refusal 3/3) |

### How this differs from a proof-of-arithmetic guard

Some verifiable-agent entries prove arithmetic over flags their own server
computed — a wallet guard, for example, scores a transaction from a set of
checks and proves `score = weighted sum of flags`. The proof is real, but
it proves the addition, not the facts: a compromised server can set all
flags to 0 and still produce a valid "SAFE" proof, and a BLOCK verdict is
only a label in the response — every input has a valid proof, including
for a refusal. Nothing is actually refused.

This entry proves something else: that the move was permitted by the policy
the owner committed to before acting. The circuit enforces the decision
itself, so a wrong move has no proof at all — the refusal is cryptographic,
not a label. The proof is also checked by a verifier the agent does not
control (Kurier / zkVerify mainnet), the policy stays hidden behind a
Poseidon commitment, and a failed proof means the move does not happen
(fail-closed).

| | Proof-of-arithmetic guard | This entry |
|---|---|---|
| What the proof proves | That `score = weighted sum of flags` (arithmetic over inputs the server computed outside the circuit) | That this move was permitted by the committed policy (the circuit enforces the decision itself) |
| Circuit | Usually custom, with a trusted setup made by its author | Official `vfy-policy` circuit, no setup of our own |
| On-chain verification | Often none — proofs verified locally only | Submitted to Kurier / zkVerify mainnet; Gatekeeper jobs Finalized (three, 13 Nov); first Steal job Finalized (`2d523ed8-e255-11f1-838e-1e6a0d14f999`, 17 Nov 2026) |
| When proving fails | Verdict still returned, with no proof (best-effort) | Agent answers HOLD with no proof (fail-closed); the move does not happen |
| Refusal | A label in the response — every input has a valid proof, including for a refusal | Cryptographic: a wrong move has no proof at all (circuit assert), demonstrated live in `npm run demo:refusal` |
| Policy privacy | Usually all inputs public — the policy is visible | Policy hidden behind a Poseidon commitment; verifiable by recompute |
| Judge can try it | A live demo form is the fastest way to show a guard | Public demo page + `npm run demo` + `npm run verify:proof` (one real proof, zero repo code) |

The clearest example of the proof-of-arithmetic approach among readable
Wildcard entries is Sentinel Guard ([markastrader/sentinel-guard](https://github.com/markastrader/sentinel-guard)) —
a wallet & transaction guard with a live demo a judge can try in 30 seconds,
which is genuinely its strongest point. The comparison above is about the
approach, not the project.

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
6. **Reveal (demo only):** after the match, the owner can open the DEMO
   strategy — params + salt — and anyone recomputes the commitment
   (`npm run reveal:demo`). The pattern is named **commit → act →
   reveal**: commit before acting, prove every act, reveal after the
   match so the commitment can be checked. Only the demo commitment is
   ever revealed; the main strategy's salt stays secret forever.

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

- `src/server.ts` + `src/turn.ts` — endpoint (incl. public GET /demo-turn, GET /proof-status, POST /treasury/check), raw-body HMAC, fail-closed HOLD, idempotency.
- `src/proof.ts` + `src/circuitInputs.ts` — Groth16 prove + local self-verify vs the official VK; Kurier submit + poll.
- `src/strategy.ts` + `src/poseidon.ts` — decision list + Poseidon commitment.
- `scripts/demo*.cjs` — demo match, defensive, refusal, treasury, attack, reveal (`npm run demo*`).
- `evidence/` — one real turn-1 proof + VK, verifiable with zero repo code (`npm run verify:proof`).
- Full file list: browse `src/` and `scripts/`.

## Where to look in the code

| What | Where |
|---|---|
| Commitment check: envelope hash must match, else HOLD | `src/turn.ts:209-211` |
| Circuit refuses a wrong move — `generatePolicyProof` throws, never returns an unverified proof | `src/proof.ts:75` (`fullProve`), `:84` (local `groth16.verify`) |
| Replay returns the cached response, never a new proof | `src/turn.ts:103` (`deriveIdempotencyKey`, SHA-256 over `matchId:turn`) |
| Kurier submit + poll until Finalized | `src/proof.ts:155` (`submitProofToKurier`), `:193` (`pollKurierJob`) |
| Decision list FORTIFY → HOLD → EXTRACT | `src/strategy.ts:78-85` (`decideActionFromParams`) |
| Pinned official circuit artifacts, SHA-256 verified at startup | `src/circuitArtifacts.ts:44` (`verifyCircuitArtifacts`; pins at `:27` and `:31`) |

## Run it / Deploy

```bash
npm install
cp .env.example .env   # fill AGENT_GAMES_HMAC_SECRET first
npm run commitment     # generate salt + commitment, writes .env.strategy
npm test               # 24 tests, all must pass
npm run demo           # 20-turn match (no Kurier unless KURIER_API_KEY is set)
npm run demo:defensive # defensive demo — FORTIFY + HOLD live (separate commitment)
npm run demo:refusal   # the refusal demo
npm run demo:treasury  # treasury guard — spend 11 refused, spend 5 proved, outside-allowlist rejected
npm run attack         # five attacks, all must fail
npm run verify:proof   # verify one real proof with zero repo code (snarkjs only)
npm run reveal:demo    # reveal the DEMO strategy and recompute its commitment
npm run build
npm start              # runs at http://localhost:3000
```

Health check: `curl http://localhost:3000/health`

Latest results (17 Nov 2026): **24 tests pass, 0 fail** — health, signed
preflight, rejection of bad/unsigned signatures, valid turn (EXTRACT 10 +
matching `publicInputsHash`), replayed `idempotencyKey` returning an
identical response, deterministic UUIDv5 key, FORTIFY/HOLD without
`amount`, expired deadline → HOLD, commitment-hash mismatch → HOLD,
circuit decision-list rules, 17 inputs wired, invalid params rejected,
commitment matching the golden value from the circuit probe, EXTRACT/HOLD/
FORTIFY proofs that prove + self-verify, a wrong action for the state
being **unprovable** (circuit assert refuses), GET /agent usage info,
GET /demo summary, POST /verify accepting a real proof and rejecting a
tampered one, the JSON store round-tripping atomically and tolerating a
corrupt file, and the pinned circuit-artifact hashes matching the files
on disk.

Live-endpoint tests (`npm run test:live`): **11 pass, 0 fail** — GET
/demo-turn returning one fresh real proof (EXTRACT 10, self-verified,
then re-verified through POST /verify), POST /treasury/check answering
real spend requests (SAFE with a real proof, REFUSED over the cap and
for the wrong size, REJECTED outside the allowlist, HELD with
FORTIFY/HOLD proofs at the floors), GET /proof-status shapes (400/503),
and CORS preflight (204).

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
For the treasury guard (`POST /treasury/check`): `STRATEGY_PARAMS_DEFENSIVE`
(`[5,50,20,0,0,0,0,0]`), `STRATEGY_SALT_DEFENSIVE` and
`STRATEGY_COMMITMENT_DEFENSIVE` (from `.env.strategy-defensive` —
commitment `0x1b633a5a1e59fadd82344fc383f6aef95d6b043d46f4fe87235bfc99d88a2a24`);
optional `TREASURY_ALLOWLIST` (comma-separated 0x addresses; default the
two demo addresses). Without the three defensive variables the treasury
route answers 503 and everything else still works.
Optional: `IDEMPOTENCY_STORE_PATH` (e.g. `/data/idempotency.json`) —
only useful on a host with a persistent volume; Railway has none
attached, so leave it unset there.
After changing Variables, click "Apply change" → Deploy — Railway does
not auto-deploy env-var changes.
Public endpoint: `https://agent-games-steal-the-vfy-production-a1295e30.up.railway.app/agent`
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
- Idempotency is stored in an **in-memory Map** (`src/turn.ts`) by
  default — lost on server restart/redeploy. Set
  `IDEMPOTENCY_STORE_PATH` (e.g. `/data/idempotency.json` on a host with
  a volume) to mirror it to disk with atomic writes (`src/store.ts`).
  Railway has no volume attached, so persistence takes effect only on a
  host with persistent disk.
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

## Proof reference (Wildcard submission)

- Repo: https://github.com/JM-03/agent-games-steal-the-vfy
- Demo endpoint: `https://agent-games-steal-the-vfy-production-a1295e30.up.railway.app/agent`
- Circuit vk_hash: `0x6c56509f1c56fd1fd4e9737f906d2220f4b95f1d507f1adf6899085bd74be047`
- Commitment (params `[10,0,0,0,0,0,0,0]`): `0x0b9f4672eb0b10bba098b648216126cb6256f43b0879833483b7f4631f61cb39`
- Kurier job id (one proof from the demo, Finalized 17 Nov 2026): `2d523ed8-e255-11f1-838e-1e6a0d14f999`
- On-chain: [Subscan extrinsic](https://zkverify.subscan.io/extrinsic/0xf73f1c21c0401880ea43a08280106626568c275ab3212bf32d4ffa74c6de3c9b) (txHash `0xf73f1c21c0401880ea43a08280106626568c275ab3212bf32d4ffa74c6de3c9b`)
- Public share: [X post, 17 Nov 2026](https://x.com/Jmartil1/status/2122677411565465703) (demo video + repo link, #AgentGames @ZKVProtocol)
