# Security policy — Steal the VFY agent

## Threat model

The guarantee this repo makes is: **even with the agent's code, keys,
salt and strategy in hand, an attacker can still only prove moves the
committed policy allows.** A wrong move has no proof at all — the
circuit refuses — and without a proof the move does not happen.

| Attacker capability | What happens | Enforced by |
|---|---|---|
| Agent fully compromised (code + keys + salt + strategy in hand) | Can only prove moves the committed policy allows; a wrong move has no proof at all | Circuit asserts on the committed params (`src/strategy.ts`, `src/proof.ts`) |
| Replay a proof for another turn | Public signals bind `matchId` + `turnNumber`, so a proof made for turn N does not verify for turn M; a platform retry of the same turn returns the cached response, never a new proof | `publicInputsHash` bound to match/turn + deterministic idempotency key per `matchId:turn` (`src/turn.ts`); persistent store when `IDEMPOTENCY_STORE_PATH` is set (`src/store.ts`) |
| Forge the commitment in the turn envelope | Commitment-hash mismatch → HOLD with no proof | Commitment check in `src/turn.ts` |
| Swap the circuit / verification key | Proofs are generated and self-verified against the official vfy-policy VK (`0x6c56…be047`); a proof from a different circuit fails local self-verification and is never sent. At startup the server verifies the pinned SHA-256 hashes of the official `.wasm` + `.zkey` and refuses to serve on a mismatch | `snarkjs.groth16.verify` in `src/proof.ts`; `src/circuitArtifacts.ts` |
| Expired task / forged signature | Expired deadline → HOLD; HMAC is verified on the raw body before JSON is parsed, and an invalid signature is rejected | Deadline check + raw-body HMAC (`src/turn.ts`, `src/server.ts`) |
| Proof generation fails for any reason | Agent answers HOLD with no proof instead of guessing | Fail-closed handler (`src/turn.ts`) |

Try the attacks yourself: `npm run attack` — five attacks, all blocked
(tampered commitment, replay, strategy swap, forged proof, unsigned
envelope). `npm run demo:refusal` — three out-of-policy moves the
circuit will not prove.

## Scope

In scope: the agent code in this repo (`src/`, `scripts/`), the
official `vfy-policy` circuit wiring, the turn endpoint
(`POST /agent`), and the public read-only routes (`GET /agent`,
`GET /demo`, `POST /verify`).

Out of scope: the Agent Games platform itself, Kurier / zkVerify
infrastructure, Railway hosting, and the demo opponent/resolver
simulation (clearly labelled as simulated on the demo page).

## What this repo does NOT protect against

- **A bad policy.** The circuit enforces the committed strategy; it
  cannot judge whether the strategy is wise. EXTRACT 10 every turn is
  a terrible treasury policy and a perfectly provable one. See "What
  this does not prove" in the README.
- **The platform / referee.** If the platform itself is compromised,
  no agent-side proof helps.
- **Secret leakage by the owner.** If the owner publishes the salt,
  anyone can read the strategy (the commitment stays binding — the
  strategy still cannot change mid-match — but its privacy is gone).
  The MAIN salt must never be revealed. Only the DEMO (defensive)
  commitment's salt is ever revealed, as part of the commit → act →
  reveal ceremony (`npm run reveal:demo`).
- **Denial of service.** The endpoint has no rate limiting; the
  platform's turn window is the only backstop.

## Reporting a vulnerability

If you find a way to make this agent prove a move outside its committed
policy — or to make it act on an unproven move — that is the finding
this repo cares most about. Please report it:

1. Open an issue at https://github.com/JM-03/agent-games-steal-the-vfy/issues
   with a minimal reproduction (envelope + expected vs actual behavior).
2. Do **not** include any secret (salt, HMAC secret, API key) in the
   report. A reproduction needs only the public commitment and the
   public circuit.
3. If the issue affects a live deployment, note that in the issue so it
   can be triaged first.

There is no bug bounty attached to this repo. Credit is given in the
issue and in the README for confirmed findings.

## Secrets

- Never send a seed phrase / private key / API key / HMAC secret / salt
  via chat or to an AI model. All secrets go through environment
  variables (`.env` / `.env.strategy` locally, Variables in Railway).
- Never commit `.env` / `.env.strategy` / `.env.strategy-defensive`.
  Never log any secret.
