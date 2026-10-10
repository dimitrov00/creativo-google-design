import type { CapacityEntry } from '../components/capacity-entry.data';

/** `YYYY-MM` — the month the document rolls up (`CapacityEntry.monthOf`). */
export type CapacityMonthId = string & { readonly __brand: unique symbol };
export const CapacityMonthId = {
  /** The only cast site. Validate the raw string at the edge, not here. */
  of: (raw: string): CapacityMonthId => raw as CapacityMonthId,
} as const;

/**
 * The calendar's cost ceiling: one month of every barber's free minutes per
 * day per shop — `capacity/{YYYY-MM}` (§9 D7). One cold read per month view,
 * a linear scan, no dynamic map keys. A projection rebuilt inside ONE
 * transaction by dropping every entry in the plan's scope and writing the
 * full sorted array — never `arrayUnion`, never a merge, never one barber's
 * plan alone.
 *
 * No `rebuiltAtMs`: none is stored, nothing reads one, and a wall-clock stamp
 * would make an otherwise deterministic rebuild non-deterministic
 * (`purgeAt` is adapter-stamped).
 */
export type CapacityMonthEntity = {
  readonly id: CapacityMonthId;
  /** `YYYY-MM`, the same as the id. */
  readonly month: string;
  /** Sorted by `(dayKey, barberId, locationId)`, one entry per key (`CapacityEntry.compare`). */
  readonly entries: readonly CapacityEntry[];
};
