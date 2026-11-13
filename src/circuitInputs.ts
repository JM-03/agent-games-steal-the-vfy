// Circuit inputs for the vfy-policy Groth16 circuit.
//
// HONEST STATUS (verified 2026-11-13 by probing the public artifacts):
// The official pages publish the circuit files and the vk_hash, but they do
// NOT publish the circuit's input signal names, and the Steal starter prompt
// on https://agentgames.zkverify.io/build is not present in the page text
// that can be fetched (only the Gatekeeper prompt is).
//
// What WAS verified, by probing circuits/vfy-policy.wasm with snarkjs
// (see scripts/probe-circuit-inputs.cjs — it asks the circuit itself which
// names are real inputs, one name at a time):
//   - The circuit takes 17 inputs in total (snarkjs: "Only 0 out of 17").
//   - Its verification key has nPublic = 9 (9 public signals).
//   - These 9 input names ARE real circuit inputs (each accepted by the
//     witness calculator):
//         commitment, matchId, selfBalance, opponentBalance, action,
//         amount, circuitVersion, turnNumber, salt
//   - About 500 other candidate names were tested and rejected, including:
//     turn, strategyCommitment, publicInputsHash, nonce, strategy,
//     thresholds, fortify/exposed/spendable variants, snake_case variants.
//   - The remaining 8 input names are UNKNOWN from every public source
//     checked. They are most likely the private strategy parameters, but
//     their exact names cannot be guessed safely — a wrong name makes the
//     proof invalid, and an invalid proof is worse than no proof.
//
// DO NOT invent the missing names. Fill them in ONLY from an authoritative
// source: the Steal starter prompt on the /build page (open it in a browser
// and copy the prompt), the circuit source, or zkVerify support / Discord.
// Then:
//   1. Add the names to MISSING_INPUT_NAMES below (move them to KNOWN_INPUTS).
//   2. Map them to values in buildCircuitInputs().
//   3. Set PROOF_ENABLED=true in your .env.
//   4. Re-run the tests (npm test) and a practice turn before any scored round.
import type { Action, TurnEnvelope } from "./types";
import { actionAmountForHash } from "./strategy";
import { ACTION_CODE, circuitVersionToNumber } from "./publicInputsHash";

/** Input names verified against the real circuit (see header). */
export const KNOWN_INPUTS = [
  "commitment",
  "matchId",
  "selfBalance",
  "opponentBalance",
  "action",
  "amount",
  "circuitVersion",
  "turnNumber",
  "salt",
] as const;

/** The circuit takes 17 inputs; 9 are known, so 8 are still missing. */
export const TOTAL_INPUTS = 17;
export const MISSING_INPUT_COUNT = TOTAL_INPUTS - KNOWN_INPUTS.length; // 8

/**
 * Names of the 8 still-unknown inputs.
 * Fill these in from an authoritative source only — see the header.
 * Until this list is empty, generatePolicyProof() refuses to run.
 * The placeholders below stand for the 8 unknown private input names;
 * replace each one with its real name (and add its value in
 * buildCircuitInputs()) as soon as it is known.
 */
export const MISSING_INPUT_NAMES: string[] = [
  "UNKNOWN_PRIVATE_INPUT_1",
  "UNKNOWN_PRIVATE_INPUT_2",
  "UNKNOWN_PRIVATE_INPUT_3",
  "UNKNOWN_PRIVATE_INPUT_4",
  "UNKNOWN_PRIVATE_INPUT_5",
  "UNKNOWN_PRIVATE_INPUT_6",
  "UNKNOWN_PRIVATE_INPUT_7",
  "UNKNOWN_PRIVATE_INPUT_8",
];

/**
 * Build the circuit input object for a turn.
 * Throws ProofInputsIncompleteError while any input name is still missing.
 * Values for the 9 known inputs follow the publicInputsHash field order and
 * the envelope: action is encoded HOLD=0 / FORTIFY=1 / EXTRACT=2 and
 * circuitVersion "v1" is encoded as 1.
 */
export function buildCircuitInputs(
  envelope: TurnEnvelope,
  action: Action,
  opts: { salt?: string } = {},
): Record<string, string> {
  // While any input name is still missing, no valid proof can be produced.
  // When the missing names are found, add them to KNOWN_INPUTS above,
  // add their values to the returned object, and clear MISSING_INPUT_NAMES.
  if (MISSING_INPUT_NAMES.length > 0) {
    throw new ProofInputsIncompleteError(
      `${MISSING_INPUT_COUNT} of ${TOTAL_INPUTS} circuit input names are still unknown. ` +
        `Known: ${KNOWN_INPUTS.join(", ")}. ` +
        `Fill in the missing names in src/circuitInputs.ts from the official Steal starter prompt or circuit source, then set PROOF_ENABLED=true.`,
    );
  }
  const commitment = envelope.strategyCommitment?.hash;
  if (!commitment) throw new ProofInputsIncompleteError("Envelope has no strategyCommitment.hash.");
  return {
    commitment: BigInt(commitment).toString(),
    matchId: BigInt("0x" + envelope.matchId.replace(/-/g, "")).toString(),
    selfBalance: BigInt(envelope.state.selfBalance).toString(),
    opponentBalance: BigInt(envelope.state.opponentBalance).toString(),
    action: ACTION_CODE[action.type].toString(),
    amount: actionAmountForHash(action).toString(),
    circuitVersion: circuitVersionToNumber("v1").toString(),
    turnNumber: BigInt(envelope.turn).toString(),
    salt: opts.salt ?? "0",
  };
}

export class ProofInputsIncompleteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProofInputsIncompleteError";
  }
}
