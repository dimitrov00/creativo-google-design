import type { GuestId, UserId } from '@core/primitives';
import type { SeatLabel } from './seat-label.data';

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
 * One member of a {@link Party} — a flat variant per role (split out of
 * `party.data.ts`, pass D D-7).
 */
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
