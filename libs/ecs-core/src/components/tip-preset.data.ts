/**
 * How a tip preset was found — the field `tipPreset`, the bento's two tile
 * sizes. The ONLY source of these strings (moved from `billing.system.ts`,
 * values unchanged).
 */
export const TipPreset = {
  /** The bill rounded up to a note a hand holds. */
  RoundUp: 'ROUND_UP',
  /** A coin on top of an exact payment. */
  Coin: 'COIN',
} as const;
export type TipPreset = (typeof TipPreset)[keyof typeof TipPreset];
