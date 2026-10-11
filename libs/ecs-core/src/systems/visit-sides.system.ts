import type { PriceCents } from '../primitives/price-cents.primitive';

/** The note and the tip, as one visit holds them. */
export type VisitSides = {
  /** The team note, `null` for none. */
  readonly note: string | null;
  /** What the chair was tipped, in cents of the seat's currency; `null` when unrecorded. */
  readonly tipCents: PriceCents | null;
};

/** Which of the side fields a write carries. */
export type SideWrites = {
  readonly note: boolean;
  readonly tip: boolean;
};

/**
 * A side-field holder that remembers what it was drawn from — the sheet's
 * draft is one.
 */
export type DrawnSides = VisitSides & {
  readonly drawn: VisitSides;
};

/**
 * The stored side fields as this device hears them. A field this device is
 * not listening to is NOT judged: `noteHeard` / `tipHeard` false (the legacy
 * `undefined`), the value beside it then meaningless and conventionally
 * `null`.
 */
export type LiveSides = {
  readonly note: string | null;
  readonly noteHeard: boolean;
  readonly tipCents: PriceCents | null;
  readonly tipHeard: boolean;
};

/**
 * VisitSidesSystem — THE SIDE FIELDS OF A VISIT, the team note and the tip
 * (`visit-editor/visit-sides.ts`). Both are written BESIDE the staff-edit
 * batch, each in a document of its own, so neither moves the visit's
 * revision and the stale-screen guard cannot see them. These rules hold
 * them to the same promise as far as one device can see: a save never
 * writes over a colleague's change it did not show the barber.
 *
 * - The holder remembers what it DREW each field from and follows the
 *   stored value while the barber leaves the field alone ({@link adopt}).
 * - A save writes only the fields the barber changed ({@link writesOf}).
 * - A changed field whose stored value moved since it was drawn, to
 *   something other than what the save would write, is a colleague's change
 *   under the barber's ({@link movedUnder}): the save is stale.
 */
export const VisitSidesSystem = {
  /** A note as it is stored: trimmed, and `null` for none. */
  storedNote(note: string | null): string | null {
    const trimmed = note === null ? '' : note.trim();
    return trimmed.length > 0 ? trimmed : null;
  },

  /** Two notes that store the same text. */
  sameNote(a: string | null, b: string | null): boolean {
    return VisitSidesSystem.storedNote(a) === VisitSidesSystem.storedNote(b);
  },

  /**
   * The stored side fields arrived: a field the barber left alone follows
   * them; one the barber changed keeps their value. A changed field whose
   * stored value now says exactly what the barber typed — their own save
   * landing, or a colleague who typed the same — is untouched again from
   * here on. The SAME holder comes back when nothing moved, so a signal
   * holding it does not fire; otherwise a new one, the input untouched.
   */
  adopt<T extends DrawnSides>(holder: T, incoming: VisitSides): T {
    const noteUntouched = VisitSidesSystem.sameNote(
      holder.note,
      holder.drawn.note,
    );
    const tipUntouched = holder.tipCents === holder.drawn.tipCents;
    const note = noteUntouched ? incoming.note : holder.note;
    const tipCents = tipUntouched ? incoming.tipCents : holder.tipCents;
    const drawn: VisitSides = {
      note:
        noteUntouched || VisitSidesSystem.sameNote(incoming.note, holder.note)
          ? incoming.note
          : holder.drawn.note,
      tipCents:
        tipUntouched || incoming.tipCents === holder.tipCents
          ? incoming.tipCents
          : holder.drawn.tipCents,
    };
    if (
      note === holder.note &&
      tipCents === holder.tipCents &&
      drawn.note === holder.drawn.note &&
      drawn.tipCents === holder.drawn.tipCents
    ) {
      return holder;
    }
    return { ...holder, note, tipCents, drawn };
  },

  /**
   * What a write of `target` carries beside the batch: each side field the
   * target changed from what it was drawn from, and nothing else.
   */
  writesOf(target: VisitSides, drawn: VisitSides): SideWrites {
    return {
      note: !VisitSidesSystem.sameNote(target.note, drawn.note),
      tip: target.tipCents !== drawn.tipCents,
    };
  },

  /**
   * Somebody else changed a field this write carries: its stored value is
   * neither what the write was drawn from nor what it would write. A field
   * this device does not hear is not judged. A stored value that already
   * says what the write would write is no conflict: writing it again
   * changes nothing, and it is also what a listener that has not yet
   * delivered the barber's own save looks like to that save's undo.
   */
  movedUnder(
    writes: SideWrites,
    drawn: VisitSides,
    target: VisitSides,
    live: LiveSides,
  ): boolean {
    const noteMoved =
      writes.note &&
      live.noteHeard &&
      !VisitSidesSystem.sameNote(live.note, drawn.note) &&
      !VisitSidesSystem.sameNote(live.note, target.note);
    const tipMoved =
      writes.tip &&
      live.tipHeard &&
      live.tipCents !== drawn.tipCents &&
      live.tipCents !== target.tipCents;
    return noteMoved || tipMoved;
  },
} as const;
