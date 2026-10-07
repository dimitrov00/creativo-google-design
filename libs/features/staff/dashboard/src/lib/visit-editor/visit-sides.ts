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
 */

/** The note and the tip, as one visit holds them. */
export interface VisitSides {
  /** The team note, `null` for none. */
  readonly note: string | null;
  /** What the chair was tipped, in minor units; `null` when unrecorded. */
  readonly tipMinorUnits: number | null;
}

/** Which of the side fields a write carries. */
export interface SideWrites {
  readonly note: boolean;
  readonly tip: boolean;
}

/**
 * A side-field holder that remembers what it was drawn from — the sheet's
 * draft is one.
 */
export interface DrawnSides extends VisitSides {
  readonly drawn: VisitSides;
}

/** A note as it is stored: trimmed, and `null` for none. */
export function storedNote(note: string | null | undefined): string | null {
  const trimmed = note?.trim() ?? '';
  return trimmed.length > 0 ? trimmed : null;
}

/** Two notes that store the same text. */
export function sameNote(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  return storedNote(a) === storedNote(b);
}

/**
 * The stored side fields arrived (the note's listener answered, a tip was
 * recorded): a field the barber left alone follows them; one the barber
 * changed keeps their value. A changed field whose stored value now says
 * exactly what the barber typed — their own save landing, or a colleague
 * who typed the same — is untouched again from here on. The same object
 * comes back when nothing moved, so a signal holding it does not fire.
 */
export function adoptSides<T extends DrawnSides>(
  holder: T,
  incoming: VisitSides,
): T {
  const noteUntouched = sameNote(holder.note, holder.drawn.note);
  const tipUntouched = holder.tipMinorUnits === holder.drawn.tipMinorUnits;
  const note = noteUntouched ? incoming.note : holder.note;
  const tipMinorUnits = tipUntouched
    ? incoming.tipMinorUnits
    : holder.tipMinorUnits;
  const drawn: VisitSides = {
    note:
      noteUntouched || sameNote(incoming.note, holder.note)
        ? incoming.note
        : holder.drawn.note,
    tipMinorUnits:
      tipUntouched || incoming.tipMinorUnits === holder.tipMinorUnits
        ? incoming.tipMinorUnits
        : holder.drawn.tipMinorUnits,
  };
  if (
    note === holder.note &&
    tipMinorUnits === holder.tipMinorUnits &&
    drawn.note === holder.drawn.note &&
    drawn.tipMinorUnits === holder.drawn.tipMinorUnits
  ) {
    return holder;
  }
  return { ...holder, note, tipMinorUnits, drawn };
}

/**
 * What a write of `target` carries beside the batch: each side field the
 * target changed from what it was drawn from, and nothing else.
 */
export function sideWritesOf(
  target: VisitSides,
  drawn: VisitSides,
): SideWrites {
  return {
    note: !sameNote(target.note, drawn.note),
    tip: target.tipMinorUnits !== drawn.tipMinorUnits,
  };
}

/**
 * Somebody else changed a field this write carries: its stored value is
 * neither what the write was drawn from nor what it would write. `live`
 * leaves a field `undefined` when this device is not listening to it, and
 * such a field is not judged. A stored value that already says what the
 * write would write is no conflict: writing it again changes nothing, and
 * it is also what a listener that has not yet delivered the barber's own
 * save looks like to that save's undo.
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
  const noteMoved =
    writes.note &&
    live.note !== undefined &&
    !sameNote(live.note, drawn.note) &&
    !sameNote(live.note, target.note);
  const tipMoved =
    writes.tip &&
    live.tipMinorUnits !== undefined &&
    live.tipMinorUnits !== drawn.tipMinorUnits &&
    live.tipMinorUnits !== target.tipMinorUnits;
  return noteMoved || tipMoved;
}
