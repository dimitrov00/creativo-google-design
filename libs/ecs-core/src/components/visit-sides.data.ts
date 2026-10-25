import type { PriceCents } from '@core/primitives';

/**
 * The note and the tip, as one visit holds them — the two side fields a
 * staff save writes BESIDE its batch (moved from `visit-sides.system.ts`,
 * pass D: the staff edit draft names it, and a component may not read the
 * systems tier). The rules over them stay `VisitSidesSystem`'s.
 */
export type VisitSides = {
  /** The team note, `null` for none. */
  readonly note: string | null;
  /** What the chair was tipped, in cents of the seat's currency; `null` when unrecorded. */
  readonly tipCents: PriceCents | null;
};
