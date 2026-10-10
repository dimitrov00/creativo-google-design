import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { deepFreeze } from '../testing';
import { GuestLabelSystem, type RequestedSubject } from './guest-label.system';

/*
 * The cases of `firstUnusedLabel — the one placeholder rule`
 * (libs/features/client/booking/src/lib/booking-flow.store.spec.ts, 5) and of
 * `labelSharedByTwoGuests — the one implementation`
 * (libs/domain/scheduling/src/lib/booking-party.spec.ts, the three over
 * plain guests), COPIED; plus the person keys the commit counts people by
 * (decide-booking.spec.ts: «Maria» and « Maria » are one guest).
 */

const S = GuestLabelSystem;
const guest = (label: string, guestKey: string | null = null) =>
  ({ kind: 'guest', label, guestKey }) as const;

describe('firstUnusedLabel — the one placeholder rule', () => {
  const placeholder = (ordinal: number): string => `Гост ${ordinal}`;

  it('counts up from `from`, stepping past every name in use', () => {
    expect(S.firstUnusedLabel([], placeholder, 1)).toBe('Гост 1');
    expect(S.firstUnusedLabel(['Гост 1', 'Гост 2'], placeholder, 1)).toBe(
      'Гост 3',
    );
    expect(S.firstUnusedLabel(['Гост 4'], placeholder, 4)).toBe('Гост 5');
    // Names that are not placeholders block nothing.
    expect(S.firstUnusedLabel(['Мария'], placeholder, 2)).toBe('Гост 2');
  });

  it('matches the label a guest is stored under — trimmed, as `SeatLabel` keeps it', () => {
    expect(S.firstUnusedLabel(['Гост 1'], (n) => ` Гост ${n} `, 1)).toBe(
      'Гост 2',
    );
  });

  it('numbers the word itself when the catalogue ignores the number — never a taken label', () => {
    expect(S.firstUnusedLabel([], () => 'Гост', 1)).toBe('Гост');
    expect(S.firstUnusedLabel(['Гост'], () => 'Гост', 1)).toBe('Гост 1');
    expect(S.firstUnusedLabel(['Гост', 'Гост 2'], () => 'Гост', 2)).toBe(
      'Гост 3',
    );
  });

  it('never answers a taken label, whatever the catalogue does with the number (property)', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.constantFrom('Гост', 'Гост 1', 'Гост 2', 'Гост 3'), {
          maxLength: 4,
        }),
        fc.boolean(),
        fc.integer({ min: 1, max: 4 }),
        (taken, ignoresNumber, from) => {
          const label = ignoresNumber ? () => 'Гост' : placeholder;
          expect(taken).not.toContain(S.firstUnusedLabel(taken, label, from));
        },
      ),
    );
  });

  it('is the SMALLEST free ordinal from `from`, and never a taken one (property)', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.integer({ min: 1, max: 12 }), { maxLength: 10 }),
        fc.integer({ min: 1, max: 6 }),
        (takenOrdinals, from) => {
          const taken = takenOrdinals.map(placeholder);
          const label = S.firstUnusedLabel(taken, placeholder, from);
          expect(taken).not.toContain(label);
          const ordinal = Number(label.replace('Гост ', ''));
          expect(ordinal).toBeGreaterThanOrEqual(from);
          for (let earlier = from; earlier < ordinal; earlier++) {
            expect(taken).toContain(placeholder(earlier));
          }
        },
      ),
    );
  });
});

describe('sharedLabel — one label, one guest', () => {
  it('finds the label two different guests answer to', () => {
    expect(
      S.sharedLabel([guest('Гост 2', 'guest-1'), guest('Гост 2', 'guest-4')]),
    ).toBe('Гост 2');
  });

  it('reads one key under one label as ONE guest with two services', () => {
    expect(
      S.sharedLabel([guest('Мария', 'guest-1'), guest('Мария', 'guest-1')]),
    ).toBeNull();
  });

  it('compares labels as they are stored — trimmed, case kept', () => {
    expect(
      S.sharedLabel([guest('Мария', 'guest-1'), guest('  Мария ', 'guest-2')]),
    ).toBe('Мария');
    expect(
      S.sharedLabel([guest('Мария', 'guest-1'), guest('мария', 'guest-2')]),
    ).toBeNull();
  });

  it('reads one label as one person when the client names nobody — as it always has', () => {
    expect(S.sharedLabel([guest('Мария'), guest('Мария')])).toBeNull();
    // A label that is not one has nothing to share; it is refused by name later.
    expect(S.sharedLabel([guest('  ', 'a'), guest('', 'b')])).toBeNull();
  });
});

describe('personKeyOf — one key per person on the cart', () => {
  it('keys the booker, an account and a guest apart', () => {
    expect(S.personKeyOf({ kind: 'self' })).toBe('self');
    expect(S.personKeyOf({ kind: 'companion', userId: 'son-1' })).toBe(
      'account:son-1',
    );
    expect(S.personKeyOf(guest('Maria'))).toBe('guest:Maria');
  });

  it('reads one label as one guest — trimmed, the way it is stored', () => {
    expect(S.personKeyOf(guest(' Maria '))).toBe(S.personKeyOf(guest('Maria')));
  });

  it('is pure: same input → same output, inputs untouched', () => {
    const subjects: readonly RequestedSubject[] = deepFreeze([
      guest('Гост 1', 'guest-1'),
      { kind: 'self' },
      guest(' Гост 1', 'guest-2'),
    ]);
    const taken = deepFreeze(['Гост 1']);
    const run = () => ({
      shared: S.sharedLabel(subjects),
      named: S.namedGuests(subjects),
      keys: subjects.map(S.personKeyOf),
      next: S.firstUnusedLabel(taken, (n) => `Гост ${n}`, 1),
    });
    const once = run();
    expect(run()).toEqual(once);
    expect(once.shared).toBe('Гост 1');
    expect(taken).toEqual(['Гост 1']);
  });
});
