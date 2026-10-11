import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { GuestId, UserId } from '../primitives/ids.primitive';
import { Party, PartyMember, PartyRole } from './party.data';
import { SeatLabel } from './seat-label.data';

const OWNER = UserId.of('u-owner');
const OTHER = UserId.of('u-other');
const COMPANION = UserId.of('u-companion');

function partyOf(...labels: readonly string[]): Party {
  let party = Party.anonymous();
  for (const label of labels) {
    const added = Party.addGuest(party, label);
    if (!added.ok) throw new Error(`bad fixture: ${label}`);
    party = added.value;
  }
  return party;
}

const labelsOf = (party: Party): readonly string[] =>
  Party.guests(party).map((guest) => guest.guestLabel);

describe('Party — anonymous until claimed', () => {
  it('opens unclaimed, with the booker as its only member', () => {
    const party = Party.anonymous();
    expect(party).toEqual({
      ownerUserId: null,
      members: [{ partyRole: 'OWNER' }],
      nextGuestSequence: 0,
    });
    expect(Party.isClaimed(party)).toBe(false);
    expect(Party.isClaimed(Party.owned(OWNER))).toBe(true);
  });

  it('carries the roster AND the counter across claim(), and re-binds to a different account', () => {
    const party = partyOf('Мария', 'Ани');
    const claimed = Party.claim(party, OWNER);
    expect(claimed.ownerUserId).toBe(OWNER);
    expect(claimed.members).toBe(party.members);
    expect(claimed.nextGuestSequence).toBe(2);
    const rebound = Party.claim(claimed, OTHER);
    expect(rebound.ownerUserId).toBe(OTHER);
    expect(labelsOf(rebound)).toEqual(['Мария', 'Ани']);
    expect(Party.claim(claimed, OWNER)).toEqual(claimed);
  });
});

describe('Party.addGuest / removeGuest', () => {
  it('adds a guest under a minted id and rejects an invalid label', () => {
    const party = partyOf('Мария');
    expect(Party.guests(party)).toEqual([
      { partyRole: PartyRole.Guest, guestId: 'guest-0', guestLabel: 'Мария' },
    ]);
    expect(Party.addGuest(party, '   ')).toEqual({
      ok: false,
      error: { errorCode: 'SCHEDULING_SEAT_LABEL_EMPTY' },
    });
    expect(Party.addGuest(party, 'x'.repeat(61)).ok).toBe(false);
  });

  it('rejects removing a guest that does not exist', () => {
    expect(Party.removeGuest(partyOf('Мария'), GuestId.of('guest-7'))).toEqual({
      ok: false,
      error: {
        errorCode: 'SCHEDULING_BOOKING_PARTY_GUEST_NOT_FOUND',
        guestId: 'guest-7',
      },
    });
    expect(
      Party.renameGuest(partyOf('Мария'), GuestId.of('guest-7'), 'Ани').ok,
    ).toBe(false);
  });

  it('never reuses a guest id after add → remove → add (blueprint §7.7 regression)', () => {
    const one = partyOf('Мария');
    const removed = Party.removeGuest(one, GuestId.of('guest-0'));
    if (!removed.ok) throw new Error('remove refused');
    expect(removed.value.nextGuestSequence).toBe(1);
    const readded = Party.addGuest(removed.value, 'Мария');
    if (!readded.ok) throw new Error('add refused');
    expect(Party.guests(readded.value).map((g) => g.guestId)).toEqual([
      'guest-1',
    ]);
  });
});

describe('Party — one label, one guest', () => {
  it('refuses to ADD a guest under a label another guest holds, with its stable code', () => {
    expect(Party.addGuest(partyOf('Мария'), 'Мария')).toEqual({
      ok: false,
      error: {
        errorCode: 'SCHEDULING_BOOKING_PARTY_DUPLICATE_LABEL',
        label: 'Мария',
      },
    });
  });

  it('compares labels as they are stored — trimmed, so « Мария » is Мария', () => {
    expect(Party.addGuest(partyOf('Мария'), '  Мария ').ok).toBe(false);
  });

  it('keeps labels that only differ in case different people', () => {
    expect(Party.addGuest(partyOf('Мария'), 'мария').ok).toBe(true);
  });

  it('refuses to RENAME a guest to another guest’s label, and leaves the party as it was', () => {
    const party = partyOf('Мария', 'Гост 2');
    const result = Party.renameGuest(party, GuestId.of('guest-1'), 'Мария');
    expect(!result.ok && result.error.errorCode).toBe(
      'SCHEDULING_BOOKING_PARTY_DUPLICATE_LABEL',
    );
    expect(labelsOf(party)).toEqual(['Мария', 'Гост 2']);
  });

  it('lets a guest keep — or re-type — their OWN label, keeping their id', () => {
    const renamed = Party.renameGuest(
      partyOf('Мария'),
      GuestId.of('guest-0'),
      ' Мария ',
    );
    expect(renamed.ok && Party.guests(renamed.value)).toEqual([
      { partyRole: 'GUEST', guestId: 'guest-0', guestLabel: 'Мария' },
    ]);
  });

  it('frees a label once its guest leaves or takes another', () => {
    const party = partyOf('Мария', 'Гост 2');
    const renamed = Party.renameGuest(party, GuestId.of('guest-0'), 'Ани');
    if (!renamed.ok) throw new Error('rename refused');
    expect(
      Party.renameGuest(renamed.value, GuestId.of('guest-1'), 'Мария').ok,
    ).toBe(true);
    const removed = Party.removeGuest(party, GuestId.of('guest-0'));
    if (!removed.ok) throw new Error('remove refused');
    expect(Party.addGuest(removed.value, 'Мария').ok).toBe(true);
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
        let party = Party.anonymous();
        for (const next of commands) {
          const target =
            next.kind === 'rename'
              ? Party.guests(party)[next.index]
              : undefined;
          const result =
            next.kind === 'add'
              ? Party.addGuest(party, next.label)
              : target !== undefined
                ? Party.renameGuest(party, target.guestId, next.label)
                : null;
          if (result?.ok) party = result.value;
          const labels = labelsOf(party);
          expect(new Set(labels).size).toBe(labels.length);
          expect(Party.sharedLabel(party)).toBeNull();
        }
      }),
    );
  });

  it('still RESTORES a persisted party that holds a duplicate — and names the label it shares', () => {
    const restored: unknown = {
      ownerUserId: null,
      members: [
        { partyRole: 'OWNER' },
        { partyRole: 'GUEST', guestId: 'guest-0', guestLabel: 'Гост 1' },
        { partyRole: 'GUEST', guestId: 'guest-1', guestLabel: 'Ани' },
        { partyRole: 'GUEST', guestId: 'guest-2', guestLabel: 'Гост 1' },
      ],
      nextGuestSequence: 3,
    };
    if (!Party.is(restored)) throw new Error('expected a restorable party');
    expect(Party.sharedLabel(restored)).toBe('Гост 1');
    const renamed = Party.renameGuest(restored, GuestId.of('guest-2'), 'Мария');
    expect(renamed.ok && Party.sharedLabel(renamed.value)).toBeNull();
  });
});

describe('Party.labelSharedByTwoGuests — the one implementation', () => {
  const g = (key: string, label: string) => ({
    key,
    label: SeatLabel.of(label),
  });

  it('finds the label two different guests answer to', () => {
    expect(
      Party.labelSharedByTwoGuests([
        g('guest-0', 'Мария'),
        g('guest-1', 'Мария'),
      ]),
    ).toBe('Мария');
  });

  it('reads one key under one label as ONE guest with two services', () => {
    expect(
      Party.labelSharedByTwoGuests([
        g('guest-0', 'Мария'),
        g('guest-0', 'Мария'),
      ]),
    ).toBeNull();
  });

  it('keeps case: Мария and мария are two people', () => {
    expect(
      Party.labelSharedByTwoGuests([
        g('guest-0', 'Мария'),
        g('guest-1', 'мария'),
      ]),
    ).toBeNull();
  });
});

describe('Party — accounts and seats', () => {
  const withCompanion: Party = {
    ownerUserId: OWNER,
    members: [
      { partyRole: 'OWNER' },
      { partyRole: 'COMPANION', companionUserId: COMPANION },
      {
        partyRole: 'GUEST',
        guestId: GuestId.of('guest-0'),
        guestLabel: SeatLabel.of('Мария'),
      },
    ],
    nextGuestSequence: 1,
  };

  it('lists every account on the visit, owner and companions, distinct and sorted', () => {
    expect(Party.subjectUserIds(withCompanion)).toEqual([
      'u-companion',
      'u-owner',
    ]);
    expect(Party.subjectUserIds(Party.anonymous())).toEqual([]);
  });

  it('knows its members by account', () => {
    expect(Party.isMember(withCompanion, OWNER)).toBe(true);
    expect(Party.isMember(withCompanion, COMPANION)).toBe(true);
    expect(Party.isMember(withCompanion, OTHER)).toBe(false);
  });

  it('names every seat, the booker first', () => {
    expect(Party.seatKeys(withCompanion)).toEqual([
      { seatKeyRole: 'SELF' },
      { seatKeyRole: 'COMPANION', companionUserId: COMPANION },
      { seatKeyRole: 'GUEST', guestId: 'guest-0' },
    ]);
  });
});

describe('Party.is — the edge guard', () => {
  it('takes what the commands build', () => {
    expect(Party.is(partyOf('Мария', 'Ани'))).toBe(true);
    expect(Party.is(Party.claim(Party.anonymous(), OWNER))).toBe(true);
  });

  it.each([
    null,
    { ownerUserId: null, members: [], nextGuestSequence: 0 },
    {
      ownerUserId: '',
      members: [{ partyRole: 'OWNER' }],
      nextGuestSequence: 0,
    },
    {
      ownerUserId: null,
      members: [{ partyRole: 'OWNER' }],
      nextGuestSequence: -1,
    },
    {
      ownerUserId: null,
      members: [{ partyRole: 'OWNER' }],
      nextGuestSequence: 0.5,
    },
    {
      ownerUserId: null,
      members: [{ partyRole: 'GUEST', guestId: 'guest-0', guestLabel: 'A' }],
      nextGuestSequence: 1,
    },
    {
      ownerUserId: null,
      members: [{ partyRole: 'OWNER' }, { partyRole: 'OWNER' }],
      nextGuestSequence: 0,
    },
    {
      ownerUserId: null,
      members: [
        { partyRole: 'OWNER' },
        { partyRole: 'GUEST', guestId: 'g0', guestLabel: 'A' },
      ],
      nextGuestSequence: 1,
    },
    {
      ownerUserId: null,
      members: [
        { partyRole: 'OWNER' },
        { partyRole: 'GUEST', guestId: 'guest-0', guestLabel: ' A ' },
      ],
      nextGuestSequence: 1,
    },
    {
      ownerUserId: null,
      members: [
        { partyRole: 'OWNER' },
        { partyRole: 'GUEST', guestId: 'guest-0', guestLabel: 'A' },
        { partyRole: 'GUEST', guestId: 'guest-0', guestLabel: 'B' },
      ],
      nextGuestSequence: 1,
    },
    {
      ownerUserId: null,
      members: [
        { partyRole: 'OWNER' },
        { partyRole: 'COMPANION', companionUserId: '' },
      ],
      nextGuestSequence: 0,
    },
    {
      ownerUserId: null,
      members: [{ partyRole: 'OWNER' }, { partyRole: 'STRANGER' }],
      nextGuestSequence: 0,
    },
  ])('refuses %j', (raw) => {
    expect(Party.is(raw)).toBe(false);
  });
});

describe('PartyMember — each member built from its tag', () => {
  it('builds the owner, a companion and a guest', () => {
    expect(PartyMember.owner()).toEqual({ partyRole: PartyRole.Owner });
    expect(PartyMember.companion(UserId.of('u-2'))).toEqual({
      partyRole: PartyRole.Companion,
      companionUserId: 'u-2',
    });
    expect(
      PartyMember.guest(GuestId.of('guest-0'), SeatLabel.of('Мария')),
    ).toEqual({
      partyRole: PartyRole.Guest,
      guestId: 'guest-0',
      guestLabel: 'Мария',
    });
  });
});
