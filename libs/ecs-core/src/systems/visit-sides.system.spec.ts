import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { PriceCents } from '@core/primitives';
import type { VisitSides } from '@core/components';
import { deepFreeze, unwrapOk } from '@core/testing';
import {
  type DrawnSides,
  type LiveSides,
  type SideWrites,
  VisitSidesSystem,
} from './visit-sides.system';

/*
 * The side fields' cases (10, two of them properties; from the dashboard
 * spec deleted in pass B), through local adapters over `VisitSidesSystem`.
 * A field this device does not hear is `heard: false` (system I/O never
 * carries `undefined`), so `live(...)` builds the reading. Plus the purity
 * case. The tip is `tipCents: PriceCents | null` (N6, Law 7), `c(300)` a
 * tip of 300 cents.
 */

const S = VisitSidesSystem;
/** A tip literal in cents. */
const c = (raw: number): PriceCents => unwrapOk(PriceCents.of(raw));
const storedNote = (note: string | null | undefined) =>
  S.storedNote(note ?? null);
const sameNote = (a: string | null | undefined, b: string | null | undefined) =>
  S.sameNote(a ?? null, b ?? null);
const adoptSides = S.adopt;
const sideWritesOf = S.writesOf;

/** The legacy live reading: `undefined` is a field this device does not hear. */
function live(sides: {
  readonly note: string | null | undefined;
  readonly tipCents: PriceCents | null | undefined;
}): LiveSides {
  return {
    note: sides.note ?? null,
    noteHeard: sides.note !== undefined,
    tipCents: sides.tipCents ?? null,
    tipHeard: sides.tipCents !== undefined,
  };
}

function sidesMovedUnder(
  writes: SideWrites,
  drawn: VisitSides,
  target: VisitSides,
  stored: {
    readonly note: string | null | undefined;
    readonly tipCents: PriceCents | null | undefined;
  },
): boolean {
  return S.movedUnder(writes, drawn, target, live(stored));
}

/** A sheet opened on `sides` and not touched since. */
function drawnFrom(sides: VisitSides): DrawnSides {
  return { ...sides, drawn: sides };
}

const NOTHING: VisitSides = { note: null, tipCents: null };

describe('the side fields — the note and the tip beside the batch', () => {
  it('stores a note trimmed, and a blank one as none', () => {
    expect(storedNote('  къса отстрани ')).toBe('къса отстрани');
    expect(storedNote('   ')).toBeNull();
    expect(storedNote(undefined)).toBeNull();
    expect(sameNote(' дължи 5 € ', 'дължи 5 €')).toBe(true);
    expect(sameNote('', null)).toBe(true);
  });

  it('appends a line below the note on a line of its own, never over it (D23)', () => {
    expect(S.appendedNote('алергия към ментол', ' наводнение ')).toBe(
      'алергия към ментол\nнаводнение',
    );
    // No note yet: the line IS the note, stored trimmed.
    expect(S.appendedNote(null, '  наводнение ')).toBe('наводнение');
    expect(S.appendedNote('   ', 'flooded')).toBe('flooded');
    // Nothing to add keeps the note as stored; nothing at all is none.
    expect(S.appendedNote(' алергия ', '  ')).toBe('алергия');
    expect(S.appendedNote(null, null)).toBeNull();
  });

  it('follows what is stored while the barber leaves a field alone', () => {
    const opened = drawnFrom(NOTHING);
    // A colleague records a tip and writes a note under the open sheet.
    const later = adoptSides(opened, { note: 'дължи 5 €', tipCents: c(300) });

    expect(later).toMatchObject({ note: 'дължи 5 €', tipCents: c(300) });
    expect(later.drawn).toEqual({ note: 'дължи 5 €', tipCents: c(300) });
    // So a save of anything else writes neither.
    expect(sideWritesOf(later, later.drawn)).toEqual({
      note: false,
      tip: false,
    });
  });

  it('keeps what the barber typed, and knows the stored value moved under it', () => {
    const typed: DrawnSides = { ...drawnFrom(NOTHING), tipCents: c(500) };
    const later = adoptSides(typed, { note: null, tipCents: c(300) });

    expect(later.tipCents).toBe(500);
    // Still drawn from «none»: the colleague's 3,00 € was never shown.
    expect(later.drawn.tipCents).toBeNull();
    const writes = sideWritesOf(later, later.drawn);
    expect(writes).toEqual({ note: false, tip: true });
    expect(
      sidesMovedUnder(writes, later.drawn, later, {
        note: null,
        tipCents: c(300),
      }),
    ).toBe(true);
  });

  it('is untouched again once the stored value says what the barber typed', () => {
    // Their own save landing, as the listener delivers it.
    const typed: DrawnSides = { ...drawnFrom(NOTHING), note: 'къса отстрани' };
    const landed = adoptSides(typed, {
      note: 'къса отстрани',
      tipCents: null,
    });

    expect(landed.drawn.note).toBe('къса отстрани');
    expect(sideWritesOf(landed, landed.drawn).note).toBe(false);
    // And a colleague's next note is followed again.
    expect(adoptSides(landed, { note: 'дължи 5 €', tipCents: null }).note).toBe(
      'дължи 5 €',
    );
  });

  it('hands back the same object when nothing moved', () => {
    const opened = drawnFrom({ note: 'дължи 5 €', tipCents: c(300) });
    expect(adoptSides(opened, { note: 'дължи 5 €', tipCents: c(300) })).toBe(
      opened,
    );
  });

  it('does not judge a field this device is not listening to', () => {
    expect(
      sidesMovedUnder(
        { note: true, tip: false },
        { note: 'a', tipCents: null },
        { note: 'b', tipCents: null },
        { note: undefined, tipCents: undefined },
      ),
    ).toBe(false);
  });

  it('is no conflict when the stored value already says what the write writes', () => {
    // A colleague typed the same — or, for an undo, the listener has not
    // yet delivered the save it is undoing.
    expect(
      sidesMovedUnder(
        { note: false, tip: true },
        { note: null, tipCents: c(500) },
        { note: null, tipCents: null },
        { note: null, tipCents: null },
      ),
    ).toBe(false);
  });

  /* ── The invariants ──────────────────────────────────────────────────── */

  const note = fc.constantFrom(null, '', 'дължи 5 €', ' дължи 5 € ', 'къса');
  const tip = fc.constantFrom(null, c(0), c(200), c(300), c(500));
  const sides = fc.record({ note, tipCents: tip });

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
            expect(holder.tipCents).toBe(last.tipCents);
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
          const tipTouched = typed.tipCents !== opened.tipCents;
          const noteTouched = !sameNote(typed.note, opened.note);
          // The colleagues' writes, none of which happens to say what the
          // barber typed (that case is the "untouched again" one above).
          const arrivals = drawnArrivals.filter(
            (entry) =>
              !(tipTouched && entry.tipCents === typed.tipCents) &&
              !(noteTouched && sameNote(entry.note, typed.note)),
          );
          const holder = arrivals.reduce(
            (current, incoming) => adoptSides(current, incoming),
            { ...typed, drawn: opened } as DrawnSides,
          );

          // What the barber typed is never taken from them.
          if (tipTouched) expect(holder.tipCents).toBe(typed.tipCents);
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
            (tipTouched && stored.tipCents !== opened.tipCents) ||
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

describe('VisitSidesSystem — purity', () => {
  it('is pure: same input → same output, inputs untouched', () => {
    // The note left alone follows what arrives; the typed tip is kept.
    const holder = deepFreeze({
      note: null,
      tipCents: c(500),
      drawn: { note: null, tipCents: null },
    } satisfies DrawnSides);
    const incoming = deepFreeze({ note: 'дължи 5 €', tipCents: c(300) });
    const once = S.adopt(holder, incoming);
    const twice = S.adopt(holder, incoming);
    expect(twice).toEqual(once);
    expect(once).not.toBe(holder);
    expect(once).toMatchObject({ note: 'дължи 5 €', tipCents: c(500) });
    expect(holder).toEqual({
      note: null,
      tipCents: c(500),
      drawn: { note: null, tipCents: null },
    });
    const writes = deepFreeze(S.writesOf(once, once.drawn));
    const stored = deepFreeze(live({ note: 'дължи 5 €', tipCents: c(300) }));
    expect(S.movedUnder(writes, once.drawn, once, stored)).toBe(true);
    expect(S.movedUnder(writes, once.drawn, once, stored)).toBe(
      S.movedUnder(writes, once.drawn, once, stored),
    );
    expect(S.appendedNote(' дължи 5 € ', 'наводнение ')).toBe(
      S.appendedNote(' дължи 5 € ', 'наводнение '),
    );
  });
});
