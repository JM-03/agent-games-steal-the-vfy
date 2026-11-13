// Default strategy for Steal the VFY.
//
// READ THIS FIRST — the official Build page says the strategy is the owner's
// TODO on purpose: "for Steal the VFY the prompt deliberately leaves your
// strategy as your own to decide ... A vibecoded harness is fine; a
// vibecoded strategy isn't a strategy."
// (https://agentgames.zkverify.io/build, section 01.5)
//
// The rules below are ONE simple, conservative starting point. They are NOT
// optimal and NOT a winning strategy. They exist so the agent has a
// deterministic, explainable behaviour while you develop a real one.
//
// What the agent can actually see in a turn envelope (official spec):
//   - turn number (1..20), both balances (start 100 each), and whether
//     either side is fortified until a given turn.
// It CANNOT see: the opponent's past actions, the opponent's strategy, or
// any history. So every rule below uses only turn + balances + fortify flags.
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
// DEFAULT STRATEGY — in plain words, in priority order:
//   1. Late and behind (turn >= 18 and selfBalance < opponentBalance):
//      EXTRACT 10 — the only way to close a gap before the match ends.
//   2. Opponent is fortified this turn: HOLD — extracting into a fortified
//      opponent loses up to 6 of the gain, so a free pass is better.
//   3. Comfortably ahead (lead >= 10) on every 3rd turn: FORTIFY —
//      protect the lead against the opponent's catch-up extraction.
//   4. Clearly behind (deficit >= 10): EXTRACT 10 — chase the leader.
//   5. Otherwise: EXTRACT 5 — the steady middle amount.
//
// To change the strategy, edit ONLY the `decideAction` function below, then
// re-run `npm run commitment` and register the new commitment hash in the
// dashboard BEFORE the next round is paired. The commitment is frozen
// mid-match, so a strategy change only takes effect from the next pairing.
import type { Action, ActionType, TurnState } from "./types";

export const STRATEGY_NAME = "conservative-default-v1";
export const STRATEGY_DESCRIPTION =
  "Late-and-behind: EXTRACT 10. Opponent fortified: HOLD. Ahead by >=10 every 3rd turn: FORTIFY. Behind by >=10: EXTRACT 10. Otherwise: EXTRACT 5.";

export const EXTRACT_MAX = 10;
export const EXTRACT_DEFAULT = 5;
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

/** The ONE function that decides the action. Edit this to change strategy. */
export function decideAction(ctx: StrategyContext): Action {
  const lead = ctx.selfBalance - ctx.opponentBalance;
  const opponentFortified =
    ctx.opponentFortifiedUntilTurn !== null && ctx.turn <= ctx.opponentFortifiedUntilTurn;

  // 1. Late and behind: go for the maximum extraction.
  if (ctx.turn >= 18 && lead < 0) return { type: "EXTRACT", amount: EXTRACT_MAX };
  // 2. Opponent is fortified: extraction is blunted, take the free pass.
  if (opponentFortified) return { type: "HOLD" };
  // 3. Comfortably ahead: spend 2 VFY to protect the lead every 3rd turn.
  if (lead >= 10 && ctx.turn % 3 === 0) return { type: "FORTIFY" };
  // 4. Clearly behind: chase with the maximum extraction.
  if (lead <= -10) return { type: "EXTRACT", amount: EXTRACT_MAX };
  // 5. Default: steady middle extraction.
  return { type: "EXTRACT", amount: EXTRACT_DEFAULT };
}

export function actionTypeOf(action: Action): ActionType {
  return action.type;
}

/** Amount that goes into the public-inputs hash: 0 for HOLD / FORTIFY. */
export function actionAmountForHash(action: Action): number {
  return action.type === "EXTRACT" ? action.amount : 0;
}

/** Canonical strategy descriptor, used to derive the commitment hash. */
export function strategyDescriptor(): Record<string, unknown> {
  return {
    name: STRATEGY_NAME,
    description: STRATEGY_DESCRIPTION,
    rules: [
      "turn>=18 and behind -> EXTRACT 10",
      "opponent fortified this turn -> HOLD",
      "lead>=10 and turn%3==0 -> FORTIFY",
      "deficit>=10 -> EXTRACT 10",
      "otherwise -> EXTRACT 5",
    ],
    constants: {
      extractMax: EXTRACT_MAX,
      extractDefault: EXTRACT_DEFAULT,
      fortifyCost: FORTIFY_COST,
      fortifyBlock: FORTIFY_BLOCK,
      matchTurns: MATCH_TURNS,
    },
  };
}
