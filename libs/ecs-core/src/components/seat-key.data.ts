import { GuestId, SeatKeyText, UserId } from '@core/primitives';

/**
 * Which member of the party a cart seat belongs to — the ONLY source of
 * these strings, named after the field it types (`seatKeyRole`, N15).
 */
export const SeatKeyRole = {
  /** The booker's own seat — always exists, whoever (if anyone) is signed in. */
  Self: 'SELF',
  /** An account the booker vouches for (carried by a staff edit or a move). */
  Companion: 'COMPANION',
  /** A guest on the party's roster, by the guest id the party minted. */
  Guest: 'GUEST',
} as const;
export type SeatKeyRole = (typeof SeatKeyRole)[keyof typeof SeatKeyRole];

const SELF_TEXT = 'self';
const GUEST_PREFIX = 'guest-';
const COMPANION_PREFIX = 'companion-';

/**
 * WHICH member of the party a cart line belongs to (`booking-cart.ts:22`). A
 * union rather than `GuestId | null`, so the booker's seat is a named case.
 * Stored and keyed by its text form ({@link SeatKey.text}, a `SeatKeyText`):
 * `'self'`, the guest's own id (`'guest-3'`, minted from the party's
 * monotonic counter, so a removed guest's key is never reused) or
 * `'companion-<uid>'` — the text is unchanged by the flatten pass.
 */
export type SeatKey = SeatKey.Self | SeatKey.Companion | SeatKey.Guest;

const SELF: SeatKey.Self = { seatKeyRole: SeatKeyRole.Self };

export const SeatKey = {
  self(): SeatKey.Self {
    return SELF;
  },

  companion(companionUserId: UserId): SeatKey.Companion {
    return { seatKeyRole: SeatKeyRole.Companion, companionUserId };
  },

  /** `guestId` is the party's minted id (`guest-<n>`). */
  guest(guestId: GuestId): SeatKey.Guest {
    return { seatKeyRole: SeatKeyRole.Guest, guestId };
  },

  /** The cart's key for a seat — `'self'`, `'guest-3'` or `'companion-<uid>'`. */
  text(key: SeatKey): SeatKeyText {
    switch (key.seatKeyRole) {
      case SeatKeyRole.Self:
        return SeatKeyText.of(SELF_TEXT);
      case SeatKeyRole.Guest:
        return SeatKeyText.of(key.guestId);
      case SeatKeyRole.Companion:
        return SeatKeyText.of(`${COMPANION_PREFIX}${key.companionUserId}`);
    }
  },

  /** A stored seat-key text back to its key, or `null` when it names no seat. */
  parse(raw: string): SeatKey | null {
    if (raw === SELF_TEXT) return SELF;
    if (raw.startsWith(GUEST_PREFIX) && raw.length > GUEST_PREFIX.length) {
      return SeatKey.guest(GuestId.of(raw));
    }
    if (
      raw.startsWith(COMPANION_PREFIX) &&
      raw.length > COMPANION_PREFIX.length
    ) {
      return SeatKey.companion(UserId.of(raw.slice(COMPANION_PREFIX.length)));
    }
    return null;
  },

  equals(a: SeatKey, b: SeatKey): boolean {
    return SeatKey.text(a) === SeatKey.text(b);
  },
} as const;

export namespace SeatKey {
  export type Self = { readonly seatKeyRole: typeof SeatKeyRole.Self };
  export type Companion = {
    readonly seatKeyRole: typeof SeatKeyRole.Companion;
    readonly companionUserId: UserId;
  };
  export type Guest = {
    readonly seatKeyRole: typeof SeatKeyRole.Guest;
    readonly guestId: GuestId;
  };
}
