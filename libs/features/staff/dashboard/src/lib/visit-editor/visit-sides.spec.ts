import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  type DrawnSides,
  type VisitSides,
  adoptSides,
  appendedNote,
  sameNote,
  sideWritesOf,
  sidesMovedUnder,
  storedNote,
} from './visit-sides';

/** A sheet opened on `sides` and not touched since. */
function drawnFrom(sides: VisitSides): DrawnSides {
  return { ...sides, drawn: sides };
}

const NOTHING: VisitSides = { note: null, tipMinorUnits: null };

describe('the side fields — the note and the tip beside the batch', () => {
  it('stores a note trimmed, and a blank one as none', () => {
    expect(storedNote('  къса отстрани ')).toBe('къса отстрани');
    expect(storedNote('   ')).toBeNull();
    expect(storedNote(undefined)).toBeNull();
    expect(sameNote(' дължи 5 € ', 'дължи 5 €')).toBe(true);
    expect(sameNote('', null)).toBe(true);
  });

  it('appends a line below the note on a line of its own, never over it (D23)', () => {
    expect(appendedNote('алергия към ментол', ' наводнение ')).toBe(
      'алергия към ментол\nнаводнение',
    );
    // No note yet: the line IS the note, stored trimmed.
    expect(appendedNote(null, '  наводнение ')).toBe('наводнение');
    expect(appendedNote('   ', 'flooded')).toBe('flooded');
    // Nothing to add keeps the note as stored; nothing at all is none.
    expect(appendedNote(' алергия ', '  ')).toBe('алергия');
    expect(appendedNote(undefined, null)).toBeNull();
  });

  it('follows what is stored while the barber leaves a field alone', () => {
    const opened = drawnFrom(NOTHING);
    // A colleague records a tip and writes a note under the open sheet.
    const later = adoptSides(opened, { note: 'дължи 5 €', tipMinorUnits: 300 });

    expect(later).toMatchObject({ note: 'дължи 5 €', tipMinorUnits: 300 });
    expect(later.drawn).toEqual({ note: 'дължи 5 €', tipMinorUnits: 300 });
    // So a save of anything else writes neither.
    expect(sideWritesOf(later, later.drawn)).toEqual({
      note: false,
      tip: false,
    });
  });

  it('keeps what the barber typed, and knows the stored value moved under it', () => {
    const typed: DrawnSides = { ...drawnFrom(NOTHING), tipMinorUnits: 500 };
    const later = adoptSides(typed, { note: null, tipMinorUnits: 300 });

    expect(later.tipMinorUnits).toBe(500);
    // Still drawn from «none»: the colleague's 3,00 € was never shown.
    expect(later.drawn.tipMinorUnits).toBeNull();
    const writes = sideWritesOf(later, later.drawn);
    expect(writes).toEqual({ note: false, tip: true });
    expect(
      sidesMovedUnder(writes, later.drawn, later, {
        note: null,
        tipMinorUnits: 300,
      }),
    ).toBe(true);
  });

  it('is untouched again once the stored value says what the barber typed', () => {
    // Their own save landing, as the listener delivers it.
    const typed: DrawnSides = { ...drawnFrom(NOTHING), note: 'къса отстрани' };
    const landed = adoptSides(typed, {
      note: 'къса отстрани',
      tipMinorUnits: null,
    });

    expect(landed.drawn.note).toBe('къса отстрани');
    expect(sideWritesOf(landed, landed.drawn).note).toBe(false);
    // And a colleague's next note is followed again.
    expect(
      adoptSides(landed, { note: 'дължи 5 €', tipMinorUnits: null }).note,
    ).toBe('дължи 5 €');
  });

  it('hands back the same object when nothing moved', () => {
    const opened = drawnFrom({ note: 'дължи 5 €', tipMinorUnits: 300 });
    expect(adoptSides(opened, { note: 'дължи 5 €', tipMinorUnits: 300 })).toBe(
      opened,
    );
  });

  it('does not judge a field this device is not listening to', () => {
    expect(
      sidesMovedUnder(
        { note: true, tip: false },
        { note: 'a', tipMinorUnits: null },
        { note: 'b', tipMinorUnits: null },
        { note: undefined, tipMinorUnits: undefined },
      ),
    ).toBe(false);
  });

  it('is no conflict when the stored value already says what the write writes', () => {
    // A colleague typed the same — or, for an undo, the listener has not
    // yet delivered the save it is undoing.
    expect(
      sidesMovedUnder(
        { note: false, tip: true },
        { note: null, tipMinorUnits: 500 },
        { note: null, tipMinorUnits: null },
        { note: null, tipMinorUnits: null },
      ),
    ).toBe(false);
  });

  /* ── The invariants ──────────────────────────────────────────────────── */

  const note = fc.constantFrom(null, '', 'дължи 5 €', ' дължи 5 € ', 'къса');
  const tip = fc.constantFrom(null, 0, 200, 300, 500);
  const sides = fc.record({ note, tipMinorUnits: tip });

  it('never writes a field the barber did not touch, whatever arrives (property)', () => {
    fc.assert(
      fc.property(
        sides,
        fc.array(sides, { maxLength: 6 }),
        (opened, arrivals) => {
          const holder = arrivals.reduce(
            (current, incoming) => adoptSides(current, incoming),
            drawnFrom(opened),
          );
          expect(sideWritesOf(holder, holder.drawn)).toEqual({
            note: false,
            tip: false,
          });
          // And it shows what arrived last.
          const last = arrivals.at(-1);
          if (last !== undefined) {
            expect(holder.tipMinorUnits).toBe(last.tipMinorUnits);
            expect(sameNote(holder.note, last.note)).toBe(true);
          }
        },
      ),
    );
  });

  it('keeps what the barber typed and refuses the save exactly when a colleague moved that field (property)', () => {
    fc.assert(
      fc.property(
        sides,
        sides,
        fc.array(sides, { maxLength: 6 }),
        (opened, typed, drawnArrivals) => {
          const tipTouched = typed.tipMinorUnits !== opened.tipMinorUnits;
          const noteTouched = !sameNote(typed.note, opened.note);
          // The colleagues' writes, none of which happens to say what the
          // barber typed (that case is the "untouched again" one above).
          const arrivals = drawnArrivals.filter(
            (entry) =>
              !(tipTouched && entry.tipMinorUnits === typed.tipMinorUnits) &&
              !(noteTouched && sameNote(entry.note, typed.note)),
          );
          const holder = arrivals.reduce(
            (current, incoming) => adoptSides(current, incoming),
            { ...typed, drawn: opened } as DrawnSides,
          );

          // What the barber typed is never taken from them.
          if (tipTouched)
            expect(holder.tipMinorUnits).toBe(typed.tipMinorUnits);
          if (noteTouched) expect(holder.note).toBe(typed.note);
          // The save carries exactly the fields they touched.
          expect(sideWritesOf(holder, holder.drawn)).toEqual({
            note: noteTouched,
            tip: tipTouched,
          });

          // Refused iff what is stored NOW differs, on a touched field, from
          // what the sheet showed when the barber started typing.
          const stored = arrivals.at(-1) ?? opened;
          const colleagueMovedIt =
            (tipTouched && stored.tipMinorUnits !== opened.tipMinorUnits) ||
            (noteTouched && !sameNote(stored.note, opened.note));
          expect(
            sidesMovedUnder(
              sideWritesOf(holder, holder.drawn),
              holder.drawn,
              holder,
              stored,
            ),
          ).toBe(colleagueMovedIt);
        },
      ),
    );
  });
});
