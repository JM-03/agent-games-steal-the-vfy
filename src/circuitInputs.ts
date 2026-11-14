// Circuit inputs for the vfy-policy Groth16 circuit.
//
// STATUS — SOLVED 2026-11-14 (see CIRCUIT_NOTES.md):
// The circuit takes 17 inputs: 9 scalars
//   commitment, matchId, selfBalance, opponentBalance, action, amount,
//   circuitVersion, turnNumber, salt
// plus ONE array input, strategyParams[0..7] (the 8 previously "missing"
// inputs are this array, not 8 separate names).
//
// The params semantics + commitment formula were solved by three
// independent participant repos that agree exactly (and were verified here
// with snarkjs fullProve + local verification against the official VK):
//   commitment = Poseidon(strategyParams[0..7], salt), params first, salt last.
//   [0] = EXTRACT amount, valid 1..10
//   [1] = FORTIFY threshold: FORTIFY when selfBalance < [1]
//   [2] = HOLD threshold: HOLD when opponentBalance <= [2] OR [3] == 1
//   [3] ∈ {0,1}; [4..7] must be exactly 0.
//   Strict priority: FORTIFY → HOLD → EXTRACT with amount == [0] exactly.
//
// The decision the agent returns MUST follow that same list for the
// configured params (see src/strategy.ts decideActionFromParams) —
// otherwise fullProve throws the circuit assert and no proof is produced.
import type { Action, TurnEnvelope } from "./types";
import { actionAmountForHash } from "./strategy";
import { ACTION_CODE, circuitVersionToNumber } from "./publicInputsHash";
import { config } from "./config";
import { validateStrategyParams } from "./strategyParams";
import { saltToBigInt } from "./poseidon";

export { validateStrategyParams };

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
  "strategyParams",
] as const;

/** The circuit takes 17 inputs: 9 scalars + strategyParams[0..7]. */
export const TOTAL_INPUTS = 17;

export interface CircuitInputOptions {
  /** Strategy params (default: config.strategyParams from STRATEGY_PARAMS). */
  params?: number[];
  /** Salt as "0x..." hex or decimal string (default: config.strategySalt). */
  salt?: string;
  /** Commitment hash override (default: envelope.strategyCommitment.hash). */
  commitment?: string;
}

/**
 * Build the 17 circuit inputs for a turn, as decimal strings (the format
 * snarkjs fullProve accepts for bn128 field elements).
 *
 * @throws ProofInputsIncompleteError when the salt or the commitment is
 *         missing, or when the params fail validation — the caller must
 *         fail closed to HOLD (no proof), never guess.
 */
export function buildCircuitInputs(
  envelope: TurnEnvelope,
  action: Action,
  opts: CircuitInputOptions = {},
): Record<string, string | string[]> {
  const params = validateStrategyParams(opts.params ?? config.strategyParams);
  const saltRaw = opts.salt ?? config.strategySalt;
  if (!saltRaw) {
    throw new ProofInputsIncompleteError(
      "STRATEGY_SALT is not set. Run `npm run commitment` to generate a fresh salt " +
        "and save it to .env.strategy (or set STRATEGY_SALT in the environment). " +
        "Without the salt no valid proof can be produced.",
    );
  }
  const salt = saltToBigInt(saltRaw).toString();
  const commitment = opts.commitment ?? envelope.strategyCommitment?.hash;
  if (!commitment) {
    throw new ProofInputsIncompleteError("Envelope has no strategyCommitment.hash.");
  }
  return {
    commitment: BigInt(commitment).toString(),
    matchId: BigInt("0x" + envelope.matchId.replace(/-/g, "")).toString(),
    selfBalance: BigInt(envelope.state.selfBalance).toString(),
    opponentBalance: BigInt(envelope.state.opponentBalance).toString(),
    action: ACTION_CODE[action.type].toString(),
    amount: actionAmountForHash(action).toString(),
    circuitVersion: circuitVersionToNumber(config.circuitVersion).toString(),
    turnNumber: BigInt(envelope.turn).toString(),
    salt,
    strategyParams: params.map((p) => p.toString()),
  };
}

export class ProofInputsIncompleteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProofInputsIncompleteError";
  }
}
