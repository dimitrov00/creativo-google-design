import type { CapacityEntry } from '../components/capacity-entry.data';
import { CapacityMonthId } from '../primitives/ids.primitive';

/**
 * The calendar's cost ceiling: one month of every barber's free minutes per
 * shop day per shop — `capacity/{YYYY-MM}` (§9 D7), the id built by
 * `LocalDate.monthKey`. One cold read per month view, a linear scan, no
 * dynamic map keys. A projection rebuilt inside ONE transaction by dropping
 * every entry in the plan's scope and writing the full sorted array — never
 * `arrayUnion`, never a merge, never one barber's plan alone.
 *
 * No `rebuiltAtMs`: none is stored, nothing reads one, and a wall-clock stamp
 * would make an otherwise deterministic rebuild non-deterministic
 * (`purgeAt` is adapter-stamped).
 */
export type CapacityMonth = {
  readonly id: CapacityMonthId;
  /** `YYYY-MM`, the same as the id. */
  readonly month: CapacityMonthId;
  /** Sorted by `(localDate, barberId, locationId)`, one entry per key (`CapacityEntry.compare`). */
  readonly entries: readonly CapacityEntry[];
};

/**
 * Flatten-pass staging: the barrel's id block still names this module for
 * `CapacityMonthId` until the integrator drops that line.
 */
