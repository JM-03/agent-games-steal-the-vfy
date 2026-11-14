// Strategy for Steal the VFY — DRIVEN BY THE CIRCUIT, not by free choice.
//
// READ THIS FIRST — the official Build page says the strategy is the owner's
// TODO on purpose: "for Steal the VFY the prompt deliberately leaves your
// strategy as your own to decide ... A vibecoded harness is fine; a
// vibecoded strategy isn't a strategy."
// (https://agentgames.zkverify.io/build, section 01.5)
//
// AND the vfy-policy circuit ENFORCES one decision list for the committed
// strategyParams (verified 2026-11-14 against the official circuit — see
// CIRCUIT_NOTES.md). The agent MUST return the action that list produces
// for the configured params, or fullProve throws the circuit assert and
// no proof is generated:
//
//   1. FORTIFY when selfBalance < params[1]
//   2. else HOLD when opponentBalance <= params[2] OR params[3] == 1
//   3. else EXTRACT with amount == params[0] exactly
//
// With the default params [10,0,0,0,0,0,0,0] that means: always EXTRACT 10,
// except HOLD when the opponent's balance is 0. FORTIFY is unreachable
// with params[1] = 0. To demonstrate FORTIFY, use params with [1] > 0,
// e.g. [10,70,0,0,0,0,0,0] (FORTIFY while selfBalance < 70).
//
// The agent can only see turn + balances + fortify flags in an envelope
// (no opponent history). The circuit list uses only the balances, so the
// fortify flags are intentionally ignored here.
//
// Game facts used (official event page):
//   - FORTIFY costs 2 VFY and blocks up to 6 VFY of incoming extraction.
//   - EXTRACT is free and steals up to N VFY (max 10) from the opponent's
//     spendable balance. A fortified opponent reduces the gain by 6.
//   - HOLD is free and moves nothing.
//   - Both sides submit simultaneously; the resolver uses prior public state
//     only, never arrival order. Highest balance after 20 turns wins.
//   - Match win +18, draw +9, loss +3 (plus small reliability bonuses).
//
// To change the strategy, change STRATEGY_PARAMS (env), re-run
// `npm run commitment` to generate a fresh salt + commitment, and register
// the new commitment hash BEFORE the next pairing. The commitment is frozen
// mid-match, so a strategy change only takes effect from the next pairing.
import { config } from "./config";
import { DEFAULT_STRATEGY_PARAMS, validateStrategyParams } from "./strategyParams";
import type { Action, ActionType, TurnState } from "./types";

export { DEFAULT_STRATEGY_PARAMS };

export const STRATEGY_NAME = "circuit-policy-v1";
export const STRATEGY_DESCRIPTION =
  "Circuit-enforced policy from STRATEGY_PARAMS: FORTIFY when selfBalance < params[1]; else HOLD when opponentBalance <= params[2] or params[3] == 1; else EXTRACT params[0]. Default [10,0,0,0,0,0,0,0] = always EXTRACT 10 (HOLD only at opponent balance 0).";

export const EXTRACT_MAX = 10;
export const FORTIFY_COST = 2;
export const FORTIFY_BLOCK = 6;
export const MATCH_TURNS = 20;

export interface StrategyContext {
  turn: number;
  selfBalance: number;
  opponentBalance: number;
  selfFortifiedUntilTurn: number | null;
  opponentFortifiedUntilTurn: number | null;
}

export function toStrategyContext(turn: number, state: TurnState): StrategyContext {
  return {
    turn,
    selfBalance: Number(state.selfBalance),
    opponentBalance: Number(state.opponentBalance),
    selfFortifiedUntilTurn: state.selfFortifiedUntilTurn ?? null,
    opponentFortifiedUntilTurn: state.opponentFortifiedUntilTurn ?? null,
  };
}

/**
 * The circuit's decision list for explicit params. Pure — no env access,
 * so tests can cover every branch with any params.
 */
export function decideActionFromParams(ctx: StrategyContext, params: number[]): Action {
  const p = validateStrategyParams(params);
  // 1. FORTIFY when selfBalance < params[1].
  if (ctx.selfBalance < p[1]) return { type: "FORTIFY" };
  // 2. HOLD when opponentBalance <= params[2] OR params[3] == 1.
  if (ctx.opponentBalance <= p[2] || p[3] === 1) return { type: "HOLD" };
  // 3. EXTRACT with amount == params[0] exactly.
  return { type: "EXTRACT", amount: p[0] };
}

/** The ONE function that decides the action, using the configured params. */
export function decideAction(ctx: StrategyContext): Action {
  return decideActionFromParams(ctx, config.strategyParams);
}

export function actionTypeOf(action: Action): ActionType {
  return action.type;
}

/** Amount that goes into the public-inputs hash: 0 for HOLD / FORTIFY. */
export function actionAmountForHash(action: Action): number {
  return action.type === "EXTRACT" ? action.amount : 0;
}

/** Canonical strategy descriptor, used for documentation / commitment context. */
export function strategyDescriptor(): Record<string, unknown> {
  return {
    name: STRATEGY_NAME,
    description: STRATEGY_DESCRIPTION,
    params: [...config.strategyParams],
    rules: [
      "selfBalance < params[1] -> FORTIFY",
      "opponentBalance <= params[2] or params[3] == 1 -> HOLD",
      "otherwise -> EXTRACT params[0]",
    ],
    constants: {
      extractMax: EXTRACT_MAX,
      fortifyCost: FORTIFY_COST,
      fortifyBlock: FORTIFY_BLOCK,
      matchTurns: MATCH_TURNS,
    },
  };
}
