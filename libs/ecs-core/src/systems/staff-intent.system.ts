import { AppliedOperation } from '../components/applied-operation.data';
import type { AppointmentId, OperationId } from '../primitives/ids.primitive';

/**
 * One of THIS device's own intents that landed on a visit: the revision it
 * was made on, and the revision it stamped (`to > from`, always).
 */
export type LandedRevision = {
  readonly from: number;
  readonly to: number;
};

/** An intent that did not land, kept under the name it went out with. */
export type UnsettledName = {
  readonly intent: string;
  readonly operationId: OperationId;
};

/**
 * How many of its own landed intents per visit a device remembers for
 * rebasing a claim (`staff-day.store.ts:115`). A sheet stays open for one
 * visit's worth of saves, not hundreds.
 */
const LANDED_PER_VISIT = 16;

/**
 * StaffIntentSystem — THE CLAIM CHAIN of a staff edit
 * (`libs/features/staff/dashboard/src/lib/staff-day.store.ts:83-115,
 * 1774-1898`), as pure folds over two short, ordered lists the store keeps
 * per visit (oldest first):
 *
 * - **the landed chain** — this device's own intents that landed, each
 *   `from → to`. A sheet's draft is drawn once; the save it sends lands at
 *   the next revision, and the undo of that save, a second save or a queued
 *   drop were made on the same screen. Claiming the drawn revision would
 *   have the server refuse them as stale against the device's OWN write, so
 *   the claim is carried forward across the chain ({@link claimFor}); only a
 *   revision somebody ELSE stamped is left unexplained.
 * - **the unsettled names** — every intent that failed (refused or lost),
 *   keyed by the intent itself ({@link intentBasis}), so the SAME intent sent
 *   again goes out under the SAME `operationId` and the server answers a
 *   lost one from its ledger instead of applying it twice. At most
 *   `AppliedOperation.CAP` per visit, oldest dropped.
 *
 * Every function returns a NEW list (or the given one when nothing
 * changes); the store replaces its value, never mutates it.
 */
export const StaffIntentSystem = {
  LANDED_PER_VISIT,
  /** At most this many failed names per visit — the server ledger's own cap. */
  UNSETTLED_PER_VISIT: AppliedOperation.CAP,

  /**
   * What makes two sends the SAME intent: the visit, the batch, and the two
   * claims beside it — an acknowledged overlap is a different decision from
   * an unacknowledged one, and a claim on another revision is a draft of
   * another visit. Serialised, because equality is the only question ever
   * asked of it; read off the request AS SENT (the claim already rebased).
   */
  intentBasis(
    appointmentId: AppointmentId,
    command: unknown,
    acknowledgedOverlap: boolean,
    expectedVersion: number | null,
  ): string {
    return JSON.stringify([
      appointmentId,
      command,
      acknowledgedOverlap,
      expectedVersion,
    ]);
  },

  /**
   * The claim an intent goes out with: the revision it was made on, carried
   * forward across every landed intent of this device. Each link strictly
   * climbs ({@link recordLanded}), so the walk ends. `null` claims nothing
   * and stays so.
   */
  claimFor(
    chain: readonly LandedRevision[],
    drawn: number | null,
  ): number | null {
    if (drawn === null) return null;
    let claim = drawn;
    for (let step = 0; step <= chain.length; step++) {
      let next: number | null = null;
      for (let i = 0; i < chain.length; i++) {
        const link = chain[i] as LandedRevision;
        if (link.from === claim) {
          next = link.to;
          break;
        }
      }
      if (next === null) break;
      claim = next;
    }
    return claim;
  },

  /**
   * An intent of this device landed: `from → to` joins the chain (replacing
   * a link from the same revision IN PLACE), and the oldest links beyond
   * {@link LANDED_PER_VISIT} drop. A claim of nothing has no revision to
   * carry forward, and a stamp that does not climb is not one an edit on
   * `from` can have written (a gateway answer with no revision reads as 0):
   * neither is recorded, and the given chain comes back.
   */
  recordLanded(
    chain: readonly LandedRevision[],
    from: number | null,
    to: number,
  ): readonly LandedRevision[] {
    if (from === null || !(to > from)) return chain;
    const next: LandedRevision[] = [];
    let replaced = false;
    for (let i = 0; i < chain.length; i++) {
      const link = chain[i] as LandedRevision;
      if (link.from === from) {
        next.push({ from, to });
        replaced = true;
      } else {
        next.push(link);
      }
    }
    if (!replaced) next.push({ from, to });
    return next.length > LANDED_PER_VISIT
      ? next.slice(next.length - LANDED_PER_VISIT)
      : next;
  },

  /** The name a failed send of this intent went out under, or `null` for a new intent. */
  operationIdFor(
    names: readonly UnsettledName[],
    intent: string,
  ): OperationId | null {
    for (let i = 0; i < names.length; i++) {
      const entry = names[i] as UnsettledName;
      if (entry.intent === intent) return entry.operationId;
    }
    return null;
  },

  /**
   * A send that failed: its name kept under its intent, NEWEST LAST (a name
   * kept again moves to the end), the oldest beyond
   * {@link UNSETTLED_PER_VISIT} dropped.
   */
  rememberUnsettled(
    names: readonly UnsettledName[],
    intent: string,
    operationId: OperationId,
  ): readonly UnsettledName[] {
    const next: UnsettledName[] = [];
    for (let i = 0; i < names.length; i++) {
      const entry = names[i] as UnsettledName;
      if (entry.intent !== intent) next.push(entry);
    }
    next.push({ intent, operationId });
    const cap = AppliedOperation.CAP;
    return next.length > cap ? next.slice(next.length - cap) : next;
  },

  /**
   * A send that landed: THAT intent is settled, every other keeps its name.
   * The given list comes back when the intent was not in it.
   */
  settle(
    names: readonly UnsettledName[],
    intent: string,
  ): readonly UnsettledName[] {
    let found = false;
    const next: UnsettledName[] = [];
    for (let i = 0; i < names.length; i++) {
      const entry = names[i] as UnsettledName;
      if (entry.intent === intent) found = true;
      else next.push(entry);
    }
    return found ? next : names;
  },
} as const;
