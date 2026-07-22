import { UserId } from '@creativo/domain/accounts';
import { describe, expect, it } from 'vitest';
import { BookingParty } from './booking-party';

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

describe('BookingParty.reconstitute', () => {
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
