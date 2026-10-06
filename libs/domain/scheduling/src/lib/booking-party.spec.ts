import { UserId } from '@creativo/domain/accounts';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { BookingParty, labelSharedByTwoGuests } from './booking-party';
import { SeatLabel } from './seat-label';
import { DuplicateGuestLabelError } from './booking-party.errors';

describe('BookingParty.create', () => {
  it('creates an empty party for a valid owner', () => {
    const result = BookingParty.create({
      ownerId: UserId.generate().toString(),
    });
    expect(result.isSuccess()).toBe(true);
    if (result.isSuccess()) {
      expect(result.value.guests).toHaveLength(0);
    }
  });

  it('rejects an empty owner id', () => {
    const result = BookingParty.create({ ownerId: '' });
    expect(result.isFailure()).toBe(true);
  });
});

describe('BookingParty.createAnonymous / claim', () => {
  it('opens unclaimed, with a usable empty roster', () => {
    const party = BookingParty.createAnonymous();
    expect(party.isClaimed()).toBe(false);
    expect(party.ownerId).toBeNull();
    expect(party.guests).toHaveLength(0);
  });

  it('lets an anonymous party add guests before anyone signs in', () => {
    const withGuest = BookingParty.createAnonymous().addGuest('Friend 1');
    expect(withGuest.isSuccess()).toBe(true);
    if (withGuest.isSuccess()) {
      expect(withGuest.value.isClaimed()).toBe(false);
      expect(withGuest.value.guests).toHaveLength(1);
    }
  });

  it('carries the roster AND the sequence counter across claim()', () => {
    const withGuest = BookingParty.createAnonymous().addGuest('Friend 1');
    if (withGuest.isFailure()) throw new Error('bad fixture');
    const firstGuestId = withGuest.value.guests[0]!.id;

    const ownerId = UserId.generate().toString();
    const claimed = withGuest.value.claim(ownerId);
    expect(claimed.isSuccess()).toBe(true);
    if (claimed.isFailure()) throw new Error('bad fixture');

    expect(claimed.value.isClaimed()).toBe(true);
    expect(claimed.value.ownerId?.toString()).toBe(ownerId);
    expect(claimed.value.guests).toHaveLength(1);

    // Signing in must not reset the §7.7 counter: the next guest added
    // after a claim still cannot collide with one added before it.
    const afterRemove = claimed.value.removeGuest(firstGuestId);
    if (afterRemove.isFailure()) throw new Error('bad fixture');
    const afterSecondAdd = afterRemove.value.addGuest('Friend 2');
    if (afterSecondAdd.isFailure()) throw new Error('bad fixture');
    expect(afterSecondAdd.value.guests[0]!.id.equals(firstGuestId)).toBe(false);
  });

  it('rejects an empty owner id', () => {
    expect(BookingParty.createAnonymous().claim('').isFailure()).toBe(true);
  });

  it('is idempotent-safe — re-claiming with the same id keeps the party intact', () => {
    const ownerId = UserId.generate().toString();
    const once = BookingParty.createAnonymous().claim(ownerId);
    if (once.isFailure()) throw new Error('bad fixture');
    const twice = once.value.claim(ownerId);
    expect(twice.isSuccess()).toBe(true);
    if (twice.isSuccess()) {
      expect(twice.value.ownerId?.toString()).toBe(ownerId);
    }
  });

  it('re-binds to a DIFFERENT account, keeping the roster and the counter', () => {
    const first = BookingParty.createAnonymous().claim(
      UserId.generate().toString(),
    );
    if (first.isFailure()) throw new Error('bad fixture');
    const withGuest = first.value.addGuest('Friend 1');
    if (withGuest.isFailure()) throw new Error('bad fixture');

    const other = UserId.generate().toString();
    const rebound = withGuest.value.claim(other);
    expect(rebound.isSuccess()).toBe(true);
    if (rebound.isFailure()) return;
    expect(rebound.value.ownerId?.toString()).toBe(other);
    expect(rebound.value.guests.map((guest) => guest.label.value)).toEqual([
      'Friend 1',
    ]);
    expect(rebound.value.nextGuestSequence).toBe(
      withGuest.value.nextGuestSequence,
    );
  });
});

describe('BookingParty.reconstitute', () => {
  it('rebuilds an unclaimed party from a null owner', () => {
    const result = BookingParty.reconstitute({
      ownerId: null,
      guests: [{ id: 'guest-0', label: 'Friend 1' }],
      nextSequence: 1,
    });
    expect(result.isSuccess()).toBe(true);
    if (result.isSuccess()) {
      expect(result.value.isClaimed()).toBe(false);
      expect(result.value.guests).toHaveLength(1);
    }
  });

  it('rebuilds guests and the sequence counter from persistence', () => {
    const result = BookingParty.reconstitute({
      ownerId: UserId.generate().toString(),
      guests: [{ id: 'guest-0', label: 'Friend 1' }],
      nextSequence: 1,
    });
    expect(result.isSuccess()).toBe(true);
    if (result.isSuccess()) {
      expect(result.value.guests).toHaveLength(1);
    }
  });

  it('rejects a negative sequence counter', () => {
    const result = BookingParty.reconstitute({
      ownerId: UserId.generate().toString(),
      guests: [],
      nextSequence: -1,
    });
    expect(result.isFailure()).toBe(true);
  });

  it('rejects an invalid guest label', () => {
    const result = BookingParty.reconstitute({
      ownerId: UserId.generate().toString(),
      guests: [{ id: 'guest-0', label: '' }],
      nextSequence: 1,
    });
    expect(result.isFailure()).toBe(true);
  });

  it('collects multiple errors at once (bad owner + bad sequence + bad guest)', () => {
    const result = BookingParty.reconstitute({
      ownerId: '',
      guests: [{ id: 'guest-0', label: '' }],
      nextSequence: -1,
    });
    expect(result.isFailure()).toBe(true);
    if (result.isFailure()) {
      expect(result.error.length).toBeGreaterThanOrEqual(3);
    }
  });
});

describe('BookingParty.addGuest / removeGuest', () => {
  it('adds a guest and rejects an invalid label', () => {
    const party = BookingParty.create({
      ownerId: UserId.generate().toString(),
    });
    if (party.isFailure()) throw new Error('bad fixture');
    const withGuest = party.value.addGuest('Friend 1');
    expect(withGuest.isSuccess()).toBe(true);
    if (withGuest.isSuccess()) {
      expect(withGuest.value.guests).toHaveLength(1);
    }

    const rejected = party.value.addGuest('   ');
    expect(rejected.isFailure()).toBe(true);
  });

  it('rejects removing a guest that does not exist', () => {
    const party = BookingParty.create({
      ownerId: UserId.generate().toString(),
    });
    if (party.isFailure()) throw new Error('bad fixture');
    const withGuest = party.value.addGuest('Friend 1');
    if (withGuest.isFailure()) throw new Error('bad fixture');
    const otherPartyGuestId = withGuest.value.guests[0]!.id;

    // Build a second, unrelated party and try to remove a guest id it never had.
    const emptyParty = BookingParty.create({
      ownerId: UserId.generate().toString(),
    });
    if (emptyParty.isFailure()) throw new Error('bad fixture');
    const result = emptyParty.value.removeGuest(otherPartyGuestId);
    expect(result.isFailure()).toBe(true);
  });

  it('never reuses a guest id after add → remove → add (blueprint §7.7 regression)', () => {
    const created = BookingParty.create({
      ownerId: UserId.generate().toString(),
    });
    if (created.isFailure()) throw new Error('bad fixture');

    const afterFirstAdd = created.value.addGuest('Friend 1');
    if (afterFirstAdd.isFailure()) throw new Error('bad fixture');
    const firstGuestId = afterFirstAdd.value.guests[0]!.id;

    const afterRemove = afterFirstAdd.value.removeGuest(firstGuestId);
    if (afterRemove.isFailure()) throw new Error('bad fixture');
    expect(afterRemove.value.guests).toHaveLength(0);

    const afterSecondAdd = afterRemove.value.addGuest('Friend 2');
    if (afterSecondAdd.isFailure()) throw new Error('bad fixture');
    const secondGuestId = afterSecondAdd.value.guests[0]!.id;

    // The whole point of the fix: a fresh id is never equal to a removed one,
    // even though the roster's *length* went 1 → 0 → 1 exactly like v2's bug.
    expect(secondGuestId.equals(firstGuestId)).toBe(false);
  });
});

/*
 * ── ONE LABEL, ONE GUEST ─────────────────────────────────────────────────
 * A guest is only a label until they have an account, and the server counts
 * people by it — so two guests under one label would travel as one person.
 */
describe('BookingParty — one label, one guest', () => {
  /** An anonymous party holding `labels`, in order. */
  function partyOf(...labels: readonly string[]): BookingParty {
    let party = BookingParty.createAnonymous();
    for (const label of labels) {
      const added = party.addGuest(label);
      if (added.isFailure()) throw new Error(`bad fixture: ${label}`);
      party = added.value;
    }
    return party;
  }

  it('refuses to ADD a guest under a label another guest holds, with its stable code', () => {
    const result = partyOf('Мария').addGuest('Мария');
    expect(result.isFailure()).toBe(true);
    if (result.isFailure()) {
      const [error] = result.error;
      expect(error).toBeInstanceOf(DuplicateGuestLabelError);
      expect(error?.code).toBe('scheduling.booking_party.duplicate_label');
      expect(error?.params).toEqual({ label: 'Мария' });
    }
  });

  it('compares labels as they are stored — trimmed, so « Мария » is Мария', () => {
    expect(partyOf('Мария').addGuest('  Мария ').isFailure()).toBe(true);
  });

  it('keeps labels that only differ in case different people — exactly what the server tells apart', () => {
    expect(partyOf('Мария').addGuest('мария').isSuccess()).toBe(true);
  });

  it('refuses to RENAME a guest to another guest’s label, and leaves the party as it was', () => {
    const party = partyOf('Мария', 'Гост 2');
    const second = party.guests[1];
    if (!second) throw new Error('bad fixture');

    const result = party.renameGuest(second.id, 'Мария');

    expect(result.isFailure()).toBe(true);
    if (result.isFailure()) {
      expect(Array.isArray(result.error) && result.error[0]).toBeInstanceOf(
        DuplicateGuestLabelError,
      );
    }
    expect(party.guests.map((guest) => guest.label.value)).toEqual([
      'Мария',
      'Гост 2',
    ]);
  });

  it('lets a guest keep — or re-type — their OWN label', () => {
    const party = partyOf('Мария');
    const only = party.guests[0];
    if (!only) throw new Error('bad fixture');
    expect(party.renameGuest(only.id, ' Мария ').isSuccess()).toBe(true);
  });

  it('frees a label once its guest leaves or takes another', () => {
    const party = partyOf('Мария', 'Гост 2');
    const [first, second] = party.guests;
    if (!first || !second) throw new Error('bad fixture');

    const renamed = party.renameGuest(first.id, 'Ани');
    if (renamed.isFailure()) throw new Error('rename refused');
    expect(renamed.value.renameGuest(second.id, 'Мария').isSuccess()).toBe(
      true,
    );

    const removed = party.removeGuest(first.id);
    if (removed.isFailure()) throw new Error('remove refused');
    expect(removed.value.addGuest('Мария').isSuccess()).toBe(true);
  });

  it('never lets any run of adds and renames leave two guests under one label (property)', () => {
    const label = fc.constantFrom('Мария', 'Ани', ' Ани', 'Гост 1', 'Гост 2');
    const command = fc.oneof(
      fc.record({ kind: fc.constant('add' as const), label }),
      fc.record({
        kind: fc.constant('rename' as const),
        index: fc.nat({ max: 4 }),
        label,
      }),
    );
    fc.assert(
      fc.property(fc.array(command, { maxLength: 12 }), (commands) => {
        let party = BookingParty.createAnonymous();
        for (const next of commands) {
          const target =
            next.kind === 'rename' ? party.guests[next.index] : null;
          const result =
            next.kind === 'add'
              ? party.addGuest(next.label)
              : target
                ? party.renameGuest(target.id, next.label)
                : null;
          if (result?.isSuccess()) party = result.value;
          const labels = party.guests.map((guest) => guest.label.value);
          expect(new Set(labels).size).toBe(labels.length);
        }
      }),
    );
  });

  it('still RESTORES a persisted party that holds a duplicate — and names the label it shares', () => {
    const restored = BookingParty.reconstitute({
      ownerId: null,
      guests: [
        { id: 'guest-0', label: 'Гост 1' },
        { id: 'guest-1', label: 'Ани' },
        { id: 'guest-2', label: 'Гост 1' },
      ],
      nextSequence: 3,
    });
    expect(restored.isSuccess()).toBe(true);
    if (restored.isFailure()) return;
    // What the flow holds such a party back by.
    expect(restored.value.sharedLabel()?.value).toBe('Гост 1');

    // One rename fixes it.
    const third = restored.value.guests[2];
    if (!third) throw new Error('bad fixture');
    const renamed = restored.value.renameGuest(third.id, 'Мария');
    expect(renamed.isSuccess() && renamed.value.sharedLabel()).toBeNull();
  });

  it('reports no shared label for any party its commands built (property)', () => {
    const label = fc.constantFrom('Мария', 'Ани', ' Ани', 'Гост 1');
    fc.assert(
      fc.property(fc.array(label, { maxLength: 8 }), (labels) => {
        let party = BookingParty.createAnonymous();
        for (const next of labels) {
          const added = party.addGuest(next);
          if (added.isSuccess()) party = added.value;
        }
        expect(party.sharedLabel()).toBeNull();
      }),
    );
  });

  it('tells a shared label from one that only differs in case', () => {
    const restored = BookingParty.reconstitute({
      ownerId: null,
      guests: [
        { id: 'guest-0', label: 'Мария' },
        { id: 'guest-1', label: 'мария' },
      ],
      nextSequence: 2,
    });
    expect(restored.isSuccess() && restored.value.sharedLabel()).toBeNull();
  });
});

/*
 * ── THE RULE ITSELF (round 5) ───────────────────────────────────────────
 * "One label, one guest" had two implementations: the party's own report
 * and a private copy in the server's decision. It has one now, and both
 * read it.
 */
describe('labelSharedByTwoGuests — the one implementation', () => {
  const label = (raw: string): SeatLabel => {
    const created = SeatLabel.create(raw);
    if (created.isFailure()) throw new Error('bad fixture');
    return created.value;
  };

  it('finds the label two different guests answer to', () => {
    expect(
      labelSharedByTwoGuests([
        { key: 'guest-1', label: label('Гост 2') },
        { key: 'guest-4', label: label('Гост 2') },
      ])?.value,
    ).toBe('Гост 2');
  });

  it('reads one key under one label as ONE guest with two services', () => {
    expect(
      labelSharedByTwoGuests([
        { key: 'guest-1', label: label('Мария') },
        { key: 'guest-1', label: label('Мария') },
      ]),
    ).toBeNull();
  });

  it('compares labels as they are stored — trimmed, case kept', () => {
    expect(
      labelSharedByTwoGuests([
        { key: 'guest-1', label: label('Мария') },
        { key: 'guest-2', label: label('  Мария ') },
      ])?.value,
    ).toBe('Мария');
    expect(
      labelSharedByTwoGuests([
        { key: 'guest-1', label: label('Мария') },
        { key: 'guest-2', label: label('мария') },
      ]),
    ).toBeNull();
  });

  it('is the party’s own report, guest for guest (property)', () => {
    const raw = fc.constantFrom('Мария', 'Ани', ' Ани', 'Гост 1');
    fc.assert(
      fc.property(fc.array(raw, { maxLength: 6 }), (labels) => {
        const restored = BookingParty.reconstitute({
          ownerId: null,
          guests: labels.map((value, index) => ({
            id: `guest-${index}`,
            label: value,
          })),
          nextSequence: labels.length,
        });
        if (restored.isFailure()) throw new Error('bad fixture');
        const party = restored.value;
        const expected = labelSharedByTwoGuests(
          party.guests.map((guest) => ({
            key: guest.id.toString(),
            label: guest.label,
          })),
        );
        expect(party.sharedLabel()?.value ?? null).toBe(
          expected?.value ?? null,
        );
        // …and it is a real clash exactly when two labels are equal.
        const trimmed = labels.map((value) => value.trim());
        expect(expected !== null).toBe(
          new Set(trimmed).size !== trimmed.length,
        );
      }),
    );
  });
});
