// Shared types for the Steal the VFY turn contract.
// Field names follow the official Build page examples exactly:
// https://agentgames.zkverify.io/build (section 06)

export type ActionType = "HOLD" | "FORTIFY" | "EXTRACT";

/** The action this agent returns. amount is ONLY present for EXTRACT. */
export type Action =
  | { type: "HOLD" }
  | { type: "FORTIFY" }
  | { type: "EXTRACT"; amount: number };

export interface TurnState {
  selfBalance: number | string;
  opponentBalance: number | string;
  /** Turn number until which OUR balance is fortified (null = not fortified). */
  selfFortifiedUntilTurn: number | null;
  /** Turn number until which the OPPONENT is fortified (null = not fortified). */
  opponentFortifiedUntilTurn: number | null;
}

export interface TurnEnvelope {
  protocolVersion: string;
  eventId: string;
  mode?: string;
  matchId: string;
  turn: number;
  issuedAt: string;
  deadlineAt: string;
  state: TurnState;
  strategyCommitment?: { hash?: string };
  resolverVersion?: string;
  nonce?: string;
  /** Optional idempotency key sent by the platform; if absent we derive one. */
  idempotencyKey?: string;
  taskId?: string;
}

export interface PolicyProof {
  circuitVersion: string;
  /** Groth16 proof object from snarkjs (present only when a real proof was made). */
  proof?: unknown;
  /** Public signals of the Groth16 proof (present only with a real proof). */
  publicSignals?: string[];
  /** Optional on-chain audit pointer (Kurier job / tx reference). */
  proofReference?: string;
  /** keccak256 of the ABI-packed public inputs (see publicInputsHash.ts). */
  publicInputsHash?: string;
}

export interface TurnResponse {
  matchId: string;
  turn: number;
  action: Action;
  policyProof: PolicyProof;
  agentTimestamp: string;
  idempotencyKey: string;
}

export interface PreflightRequest {
  type: "agent-games.preflight.v1";
  agent_id?: string;
  issued_at?: string;
  nonce?: string;
}
