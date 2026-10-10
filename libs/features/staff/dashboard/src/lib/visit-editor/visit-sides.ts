import {
  type DrawnSides as EcsDrawnSides,
  type LiveSides,
  type SideWrites as EcsSideWrites,
  type VisitSides as EcsVisitSides,
  VisitSidesSystem,
} from '@creativo/ecs-core';

/**
 * THE SIDE FIELDS OF A VISIT — the team note and the tip (round 5).
 *
 * Both are written BESIDE the `staffEdit` batch, each in a document of its
 * own: the note in the staff-only notes collection, the tip as a stamp on
 * one of the chair's seats (`recordSeatTip`). Neither moves the visit's
 * revision, so the stale-screen guard the batch claims (`expectedVersion`)
 * cannot see them. These rules hold them to the same promise, as far as
 * this device can see: a save never writes over a colleague's change it
 * did not show the barber.
 *
 * - The draft remembers what it DREW each field from (`drawn`) and follows
 *   the stored value while the barber leaves the field alone
 *   (`adoptSides`), so an untouched field always shows what is stored now.
 * - A save writes only the fields the barber changed from what they drew
 *   (`sideWritesOf`). An untouched field is never written, however old the
 *   screen.
 * - A changed field whose stored value moved since it was drawn, to
 *   something other than what the save would write, is a colleague's
 *   change under the barber's (`sidesMovedUnder`). The save is stale:
 *   nothing is written, and the sheet reloads the visit.
 *
 * One implementation, read by the sheet (adoption) and by the dashboard
 * (the writes and the check), for the save and its undo alike.
 *
 * Phase 2 shim: the rules are `VisitSidesSystem` in `@creativo/ecs-core`.
 * This file keeps the legacy names and the legacy live reading (`undefined`
 * for a field this device does not hear) for its callers.
 */

/** The note and the tip, as one visit holds them. */
export type VisitSides = EcsVisitSides;

/** Which of the side fields a write carries. */
export type SideWrites = EcsSideWrites;

/**
 * A side-field holder that remembers what it was drawn from — the sheet's
 * draft is one.
 */
export type DrawnSides = EcsDrawnSides;

/** A note as it is stored: trimmed, and `null` for none. */
export function storedNote(note: string | null | undefined): string | null {
  return VisitSidesSystem.storedNote(note ?? null);
}

/** Two notes that store the same text. */
export function sameNote(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  return VisitSidesSystem.sameNote(a ?? null, b ?? null);
}

/**
 * The stored side fields arrived: a field the barber left alone follows
 * them; one the barber changed keeps their value. The same object comes back
 * when nothing moved, so a signal holding it does not fire.
 */
export function adoptSides<T extends DrawnSides>(
  holder: T,
  incoming: VisitSides,
): T {
  return VisitSidesSystem.adopt(holder, incoming);
}

/**
 * What a write of `target` carries beside the batch: each side field the
 * target changed from what it was drawn from, and nothing else.
 */
export function sideWritesOf(
  target: VisitSides,
  drawn: VisitSides,
): SideWrites {
  return VisitSidesSystem.writesOf(target, drawn);
}

/**
 * Somebody else changed a field this write carries. `live` leaves a field
 * `undefined` when this device is not listening to it, and such a field is
 * not judged.
 */
export function sidesMovedUnder(
  writes: SideWrites,
  drawn: VisitSides,
  target: VisitSides,
  live: {
    readonly note: string | null | undefined;
    readonly tipMinorUnits: number | null | undefined;
  },
): boolean {
  return VisitSidesSystem.movedUnder(writes, drawn, target, toLive(live));
}

/** The legacy live reading → the system's (`undefined` is "not heard"). */
function toLive(live: {
  readonly note: string | null | undefined;
  readonly tipMinorUnits: number | null | undefined;
}): LiveSides {
  return {
    note: live.note ?? null,
    noteHeard: live.note !== undefined,
    tipMinorUnits: live.tipMinorUnits ?? null,
    tipHeard: live.tipMinorUnits !== undefined,
  };
}
