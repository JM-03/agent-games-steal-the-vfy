# How to prove an agent stayed inside its policy

*Steal the VFY — a Wildcard entry for zkVerify Agent Games. Built by Elgi
(@jmartil1) with his AI assistant jink. Repo:
https://github.com/JM-03/agent-games-steal-the-vfy — public demo page:
https://jm-03.github.io/agent-games-steal-the-vfy/demo.html*

## The problem: the unprovable agent

Giving an agent a wallet means giving it the money. The usual answer to
"how do we know it behaved?" is an audit log — a record the agent wrote
about itself. That proves nothing: a compromised agent writes a clean log
about a dirty move.

The enemy is not a "bad agent". It is **the unprovable agent**: a
black-box agent holding keys to a treasury, where one move outside its
mandate can drain funds and nobody can prove who is at fault. Every agent
move should be provably bound to the strategy its owner committed to — or
it shouldn't move money.

This write-up describes a working implementation of that idea, built for
the Steal the VFY track of zkVerify Agent Games. The game is only the
arena: two agents, 100 VFY each, 20 turns, three actions (FORTIFY,
EXTRACT, HOLD). The pattern is general — a trading bot capped at a loss
limit, a governance agent bound to a voted mandate, a wallet guard bound
to an allowlist — and the game is the hardest possible test of it: an
adversarial opponent, a public commitment, and a referee that cannot be
bribed.

## Commit once

Before a match, the owner picks 8 strategy numbers and a random salt, then
publishes only one thing: a Poseidon commitment over those numbers. The
strategy itself stays secret — only its hash is public.

That single design choice does two things. First, the strategy cannot
change mid-match: a new strategy needs a new commitment, and the
commitment is a public input to every proof. Second, the policy is
checkable without being revealed: anyone the owner shows the strategy to
can recompute the commitment off chain and confirm it matches.

The default strategy in this repo is deliberately the simplest provable
one: `[10,0,0,0,0,0,0,0]` — always EXTRACT 10. It is not a claim of a
winning strategy. It is a claim that the mechanism works even for a
one-line policy — and a second, defensive strategy
(`[5,50,20,0,0,0,0,0]`, its own commitment) proves the mechanism is
general: it fires FORTIFY 9 times and HOLD 4 times across two matches.

## Prove every move

Each turn, the agent decides strictly by the official circuit's decision
list — FORTIFY, then HOLD, then EXTRACT — and generates a Groth16 proof
against the official `vfy-policy` circuit (Groth16/bn128, 17 witness
inputs, 9 public signals, vk_hash `0x6c56…be047`) that the move is
permitted by the committed strategy. The proof is self-verified locally
before the agent answers; a proof that fails local verification is never
sent. Proofs are submitted to Kurier for verification on zkVerify
mainnet.

The numbers from the repo's demo scripts (all runnable in about a minute,
no platform needed):

| Check | Result |
|---|---|
| Demo match, 20 turns | 20/20 proved + locally verified, final 168–28 |
| Defensive demo, 2 matches | 40/40 proved + locally verified (FORTIFY x9, HOLD x4) |
| Refusal demo | 2/2 out-of-policy moves refused by the circuit |
| Test suite | 19/19 pass |

Every move carries a 256-byte proof. Verifying one directly on Ethereum
would cost about 272,000 gas for 9 public inputs (Horizen Labs' formula:
~207,700 gas fixed + ~7,160 per public input); zkVerify cuts
verification cost by up to 90% versus Ethereum. Trusting the agent's own
logs costs $0 and proves nothing; verifying each move on zkVerify makes
it checkable by anyone, permanently.

## The refusal is the product

The strongest evidence in this repo is not a successful match — it is a
failed one. The refusal demo attempts two out-of-policy moves against the
real committed strategy and the real circuit:

1. Prove EXTRACT 11 when the committed cap is 10 — the circuit refuses
   (`Assert Failed`, template line 149). No proof exists for this move.
2. Prove EXTRACT 10 when the opponent's balance is 0 and the strategy
   says HOLD — the circuit refuses (line 140). No proof exists either.

In both cases the agent never sends the refused move. It answers the
in-policy action (HOLD) and proves that one instead. A third case — a
turn envelope with a tampered commitment hash — also fails closed to
HOLD with no proof.

This is the guarantee, stated exactly: even with the agent's code, keys,
salt and strategy in hand, a fully compromised agent can still only prove
moves the committed policy allows. It cannot invent a move, change the
strategy mid-match, or reuse a proof. Verification is the gate, not a
badge — without the proof, the move does not happen.

That design answers the question zkVerify itself asks of every agent —
*did the agent do what it claims?* — with a receipt onchain. And it fills
a slot the industry has already named but left empty: ERC-8004, the
Ethereum "Trustless Agents" standard, defines a Validation Registry where
independent validators return a score plus proof that an agent did what
it claims — but that registry was pulled back for rework and is not in
the official mainnet set. This entry is a concrete implementation of that
slot: a validator returning a ZK proof per move. (Not a claim of ERC-8004
compliance — there is no real registration.)

## Why ZK, and not the alternatives

There is more than one way to make an agent checkable, and the choice
here is deliberate. A TEE (Oasis ROFL, NEAR Shade, Phala) proves the
*right code is running* — but it needs trust in a hardware vendor, and it
cannot prove a move stayed inside a committed policy. A signing policy
(Lit Protocol) answers *who may sign* — not whether this move matches the
strategy. An audit log answers nothing. A ZK proof answers the exact
question that matters for money: was this move allowed by the policy the
owner committed to before acting? The spectrum, plainly: TEE is proof by
hardware, bond/slashing is proof by economics, multi-model consensus is
proof by social agreement — ZK is proof by mathematics about the decision
itself.

## Honest limits

- The Steal tournament entries are locked, so this is a Wildcard demo,
  not a tournament entry. The demo match is a local simulation against a
  scripted opponent; the proofs are real.
- The strategy is fixed by the circuit's decision list — the agent cannot
  use a free-form strategy (for example, reacting to opponent history);
  only the 8 strategy numbers can change, and every change needs a new
  commitment.
- Idempotency is stored in an in-memory map — lost on server restart. For
  production, use a persistent store.
- A refused move produces no proof, so no Kurier receipt exists for a
  refusal — the demo output is the evidence.
- The Kurier job id for a Steal proof is still pending (it needs a demo
  run with the key set); the pipeline itself is proven — the same setup
  has already had Gatekeeper proofs Finalized on mainnet.

## Verify it yourself

```bash
git clone https://github.com/JM-03/agent-games-steal-the-vfy.git
cd agent-games-steal-the-vfy
npm install
npm run build
npm run demo           # 20-turn match, real proofs
npm run demo:defensive # FORTIFY + HOLD live
npm run demo:refusal   # watch an illegal move fail
npm test               # 19/19 tests
```

No account, no key, no platform needed to reproduce any of it. The full
transcript — every turn, every refusal — is on the public demo page:
https://jm-03.github.io/agent-games-steal-the-vfy/demo.html
