import { GuestId, type UserId, Result } from '@core/primitives';
import { SchedulingError } from '@core/errors';
import { SeatKey } from './cart-line.data';
import { SeatLabel } from './seat-label.data';

/**
 * Who a party member is — the ONLY source of these strings, named after the
 * field it types (`partyRole`, N15).
 */
export const PartyRole = {
  /** The booker — the `self` seat, always present, owned or not yet. */
  Owner: 'OWNER',
  /** Someone with an account of their own on the booker's visit. */
  Companion: 'COMPANION',
  /** A guest the booker names, known only by a label. */
  Guest: 'GUEST',
} as const;
export type PartyRole = (typeof PartyRole)[keyof typeof PartyRole];

/**
 * WHO is booking — the party assembling a booking before it becomes an
 * appointment's seats (`booking-party.ts`). **In memory and in the booking
 * draft only** (F-8: in-memory UI state keeps its named references): the
 * appointment stores `ownerUserId`/`subjectUserIds` and its seats'
 * occupants, from which `AppointmentIndexSystem.queryKeys` re-derives the
 * party.
 *
 * - `ownerUserId` is `null` while the party is unclaimed: `/book` is browsable
 *   anonymously, and a party graduates by {@link Party.claim} on sign-in. It
 *   is the signed-in booker's ACCOUNT (D29): the booking pipeline resolves
 *   the customer.
 * - `members` starts with the owner, then companions and guests in the order
 *   they joined.
 * - `nextGuestSequence` is the monotonic counter guest ids are minted from
 *   (`guest-<n>`); removing a guest never rewinds it, so a fresh guest can
 *   never inherit a removed one's id — or their cart lines (legacy bug 7.7).
 * - ONE LABEL, ONE GUEST: a guest's label is their identity on the wire, so
 *   the commands refuse a label another guest holds.
 */
export type Party = {
  readonly ownerUserId: UserId | null;
  readonly members: readonly PartyMember[];
  readonly nextGuestSequence: number;
};

/** One member of a {@link Party} — a flat variant per role. */
export type PartyMember =
  PartyMember.Owner | PartyMember.Companion | PartyMember.Guest;

const OWNER: PartyMember.Owner = { partyRole: PartyRole.Owner };

export const PartyMember = {
  /** The booker — one per party, always first. */
  owner(): PartyMember.Owner {
    return OWNER;
  },
  companion(companionUserId: UserId): PartyMember.Companion {
    return { partyRole: PartyRole.Companion, companionUserId };
  },
  guest(guestId: GuestId, guestLabel: SeatLabel): PartyMember.Guest {
    return { partyRole: PartyRole.Guest, guestId, guestLabel };
  },
} as const;

export namespace PartyMember {
  export type Owner = { readonly partyRole: typeof PartyRole.Owner };
  export type Companion = {
    readonly partyRole: typeof PartyRole.Companion;
    readonly companionUserId: UserId;
  };
  export type Guest = {
    readonly partyRole: typeof PartyRole.Guest;
    readonly guestId: GuestId;
    readonly guestLabel: SeatLabel;
  };
}

const GUEST_PREFIX = 'guest-';

/** The guest member `guestId`'s index in `members`, or `-1`. */
function guestIndex(party: Party, guestId: GuestId): number {
  for (let i = 0; i < party.members.length; i++) {
    const member = party.members[i] as PartyMember;
    if (member.partyRole === PartyRole.Guest && member.guestId === guestId) {
      return i;
    }
  }
  return -1;
}

/** `raw` as a label a guest may take — real, and no OTHER guest's (`except` keeps their own). */
function labelFor(
  party: Party,
  raw: string,
  except: GuestId | null,
): Result<SeatLabel, SchedulingError> {
  const parsed = SeatLabel.parse(raw);
  if (!parsed.ok) return parsed;
  for (let i = 0; i < party.members.length; i++) {
    const member = party.members[i] as PartyMember;
    if (
      member.partyRole === PartyRole.Guest &&
      member.guestId !== except &&
      member.guestLabel === parsed.value
    ) {
      return Result.err(SchedulingError.partyDuplicateLabel(parsed.value));
    }
  }
  return parsed;
}

function isMember(raw: unknown): raw is PartyMember {
  if (raw === null || typeof raw !== 'object') return false;
  const member = raw as Readonly<Record<string, unknown>>;
  switch (member['partyRole']) {
    case PartyRole.Owner:
      return true;
    case PartyRole.Companion: {
      const userId = member['companionUserId'];
      return typeof userId === 'string' && userId.length > 0;
    }
    case PartyRole.Guest: {
      const label = member['guestLabel'];
      return (
        typeof member['guestId'] === 'string' &&
        member['guestId'].startsWith(GUEST_PREFIX) &&
        typeof label === 'string' &&
        SeatLabel.parse(label).ok &&
        label === label.trim()
      );
    }
    default:
      return false;
  }
}

export const Party = {
  /** A party with no owner yet — the state `/book` opens in. */
  anonymous(): Party {
    return {
      ownerUserId: null,
      members: [PartyMember.owner()],
      nextGuestSequence: 0,
    };
  },

  /** A party owned from the start. */
  owned(ownerUserId: UserId): Party {
    return {
      ownerUserId,
      members: [PartyMember.owner()],
      nextGuestSequence: 0,
    };
  },

  isClaimed(party: Party): boolean {
    return party.ownerUserId !== null;
  },

  /**
   * Attach the signed-in booker. The roster and the counter carry over
   * untouched; re-claiming with the same id changes nothing, and a different
   * id re-binds the party to whoever is signed in now.
   */
  claim(party: Party, ownerUserId: UserId): Party {
    return {
      ownerUserId,
      members: party.members,
      nextGuestSequence: party.nextGuestSequence,
    };
  },

  /** The guests, in roster order. */
  guests(party: Party): readonly PartyMember.Guest[] {
    const guests: PartyMember.Guest[] = [];
    for (let i = 0; i < party.members.length; i++) {
      const member = party.members[i] as PartyMember;
      if (member.partyRole === PartyRole.Guest) guests.push(member);
    }
    return guests;
  },

  /** Every seat in the party: the booker first, then companions and guests in member order. */
  seatKeys(party: Party): readonly SeatKey[] {
    const keys: SeatKey[] = [SeatKey.self()];
    for (let i = 0; i < party.members.length; i++) {
      const member = party.members[i] as PartyMember;
      if (member.partyRole === PartyRole.Companion) {
        keys.push(SeatKey.companion(member.companionUserId));
      } else if (member.partyRole === PartyRole.Guest) {
        keys.push(SeatKey.guest(member.guestId));
      }
    }
    return keys;
  },

  /**
   * Add a guest under a fresh id minted from the counter, which always
   * advances. Refuses a blank or over-long label and one another guest
   * already answers to (`SCHEDULING_BOOKING_PARTY_DUPLICATE_LABEL`).
   */
  addGuest(party: Party, rawLabel: string): Result<Party, SchedulingError> {
    const label = labelFor(party, rawLabel, null);
    if (!label.ok) return label;
    const guest = PartyMember.guest(
      GuestId.of(`${GUEST_PREFIX}${party.nextGuestSequence}`),
      label.value,
    );
    return Result.ok({
      ownerUserId: party.ownerUserId,
      members: [...party.members, guest],
      nextGuestSequence: party.nextGuestSequence + 1,
    });
  },

  /** Remove a guest — never touches the counter (§7.7: it only ever grows). */
  removeGuest(party: Party, guestId: GuestId): Result<Party, SchedulingError> {
    const at = guestIndex(party, guestId);
    if (at === -1)
      return Result.err(SchedulingError.partyGuestNotFound(guestId));
    const members: PartyMember[] = [];
    for (let i = 0; i < party.members.length; i++) {
      if (i !== at) members.push(party.members[i] as PartyMember);
    }
    return Result.ok({
      ownerUserId: party.ownerUserId,
      members,
      nextGuestSequence: party.nextGuestSequence,
    });
  },

  /**
   * Relabel a guest in place, keeping their identity (and so their cart
   * lines). Refuses another guest's label, never the guest's own.
   */
  renameGuest(
    party: Party,
    guestId: GuestId,
    rawLabel: string,
  ): Result<Party, SchedulingError> {
    const at = guestIndex(party, guestId);
    if (at === -1)
      return Result.err(SchedulingError.partyGuestNotFound(guestId));
    const label = labelFor(party, rawLabel, guestId);
    if (!label.ok) return label;
    const members = [...party.members];
    members[at] = PartyMember.guest(guestId, label.value);
    return Result.ok({
      ownerUserId: party.ownerUserId,
      members,
      nextGuestSequence: party.nextGuestSequence,
    });
  },

  /**
   * ONE LABEL, ONE GUEST, detected: a label two DIFFERENT guests answer to,
   * or `null`. `key` tells guests apart where the caller stands (the guest id
   * in the flow, the cart's seat key on the wire); one key under one label is
   * one guest with two services, not a clash. Labels compare as stored —
   * trimmed, case kept. The rule's one implementation: the flow and the
   * server's decision both ask it.
   */
  labelSharedByTwoGuests(
    guests: readonly Party.LabelledGuest[],
  ): SeatLabel | null {
    for (let i = 0; i < guests.length; i++) {
      const guest = guests[i] as Party.LabelledGuest;
      for (let k = 0; k < i; k++) {
        const earlier = guests[k] as Party.LabelledGuest;
        if (earlier.label === guest.label && earlier.key !== guest.key) {
          return guest.label;
        }
      }
    }
    return null;
  },

  /**
   * The party's own report on one label, one guest — `null` for every party
   * the commands built; only a restored draft from before the rule can hold
   * a duplicate, which the flow keeps on the services step until renamed.
   */
  sharedLabel(party: Party): SeatLabel | null {
    const guests = Party.guests(party);
    const labelled: Party.LabelledGuest[] = [];
    for (let i = 0; i < guests.length; i++) {
      const guest = guests[i] as PartyMember.Guest;
      labelled.push({ key: guest.guestId, label: guest.guestLabel });
    }
    return Party.labelSharedByTwoGuests(labelled);
  },

  /** Every account on the visit — the owner (when claimed) and the companions — distinct, sorted. */
  subjectUserIds(party: Party): readonly UserId[] {
    const ids: UserId[] = [];
    if (party.ownerUserId !== null) ids.push(party.ownerUserId);
    for (let i = 0; i < party.members.length; i++) {
      const member = party.members[i] as PartyMember;
      if (
        member.partyRole === PartyRole.Companion &&
        !ids.includes(member.companionUserId)
      ) {
        ids.push(member.companionUserId);
      }
    }
    return ids.sort();
  },

  /** Is `userId` one of the party's accounts? */
  isMember(party: Party, userId: UserId): boolean {
    if (party.ownerUserId === userId) return true;
    for (let i = 0; i < party.members.length; i++) {
      const member = party.members[i] as PartyMember;
      if (
        member.partyRole === PartyRole.Companion &&
        member.companionUserId === userId
      ) {
        return true;
      }
    }
    return false;
  },

  /**
   * The edge guard for a persisted party: an owner id or `null`, the owner
   * member first and only once, well-formed companions and guests (guest ids
   * `guest-<n>`, unique; labels canonical), and a non-negative integer
   * counter. A party holding a duplicate LABEL passes — it is the booker's to
   * fix with one rename ({@link sharedLabel}).
   */
  is(raw: unknown): raw is Party {
    if (raw === null || typeof raw !== 'object') return false;
    const party = raw as Readonly<Record<string, unknown>>;
    const owner = party['ownerUserId'];
    if (owner !== null && (typeof owner !== 'string' || owner.length === 0)) {
      return false;
    }
    const sequence = party['nextGuestSequence'];
    if (
      typeof sequence !== 'number' ||
      !Number.isInteger(sequence) ||
      sequence < 0
    ) {
      return false;
    }
    const members = party['members'];
    if (!Array.isArray(members) || members.length === 0) return false;
    const guestIds: string[] = [];
    for (let i = 0; i < members.length; i++) {
      const member: unknown = members[i];
      if (!isMember(member)) return false;
      if ((member.partyRole === PartyRole.Owner) !== (i === 0)) return false;
      if (member.partyRole === PartyRole.Guest) {
        if (guestIds.includes(member.guestId)) return false;
        guestIds.push(member.guestId);
      }
    }
    return true;
  },
} as const;

export namespace Party {
  /** A guest as {@link Party.labelSharedByTwoGuests} reads one. */
  export type LabelledGuest = {
    readonly key: string;
    readonly label: SeatLabel;
  };
}
