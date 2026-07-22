import { UserId } from '@creativo/domain/accounts';
import { ServiceId } from '@creativo/domain/catalog';
import { SeatId } from './ids';
import { SeatLabel } from './seat-label';

/**
 * How the seat's subject relates to the booking party's owner.
 *   - `self`      — the booker's own seat (only legal on a `self_serve` party).
 *   - `companion` — a friend/family member the booker vouches for.
 *   - `client`    — an arbitrary third party a STAFF member books for.
 */
export type SeatRelationship = 'self' | 'companion' | 'client';

/**
 * WHO an appointment seat is FOR — the second of the two booking axes (the
 * first is `BookingParty`, WHO BOOKS). Ported from v2's `Subject` union,
 * trimmed to the two tiers this pass actually needs:
 *   - `anonymous` — no account, no PII beyond a `SeatLabel` handle
 *     (`'Walk-in 14:30'`). The minimum-viable subject a barber can commit
 *     one-tap mid-cut.
 *   - `account`   — a registered `User` (`@creativo/domain/accounts`),
 *     referenced by `UserId` only — never an embedded entity.
 *
 * Deviation from v2: v2's middle `provisioned` tier (a phone-only
 * "foothold" account, pre-registration) is dropped — `@creativo/domain/accounts`
 * in this workspace has no such foothold concept yet, so there is nothing
 * to port it onto. Add it back if/when accounts grows one.
 */
export type SeatSubject =
  | { readonly kind: 'anonymous'; readonly label: SeatLabel }
  | {
      readonly kind: 'account';
      readonly userId: UserId;
      readonly relationship: SeatRelationship;
    };

export const SeatSubject = {
  anonymous(label: SeatLabel): SeatSubject {
    return { kind: 'anonymous', label };
  },
  account(userId: UserId, relationship: SeatRelationship): SeatSubject {
    return { kind: 'account', userId, relationship };
  },
  /** A subject with no identity and no contact channel. */
  isContactless(subject: SeatSubject): boolean {
    return subject.kind === 'anonymous';
  },
} as const;

export interface SeatProps {
  readonly id: SeatId;
  readonly subject: SeatSubject;
  readonly serviceId: ServiceId;
}

/**
 * One person being served within an `Appointment` — a party of N people is
 * one `Appointment` with N seats (the appointment is the consistency
 * boundary; cancelling the whole party is one write). Each seat books
 * exactly one `ServiceId`; `Appointment` carries the shared `barberId`/
 * `locationId` for the whole slot (deviation from v2's per-seat
 * `BarberPref`/variant model — simplified for this pass, see deviation log).
 *
 * `Seat.of` is a trusted assembler, not a validating `create()`: every
 * argument (`SeatId`, `SeatSubject`'s `UserId`/`SeatLabel`, `ServiceId`) is
 * already a validated domain value by the time a `Seat` is built — there is
 * no raw primitive entering here, so there is nothing left for a `Seat`
 * itself to validate. Multi-seat invariants that span the whole appointment
 * (at most one `self` seat, etc.) are enforced by `Appointment.schedule`/
 * `reconstitute`, not here.
 */
export class Seat {
  private constructor(
    readonly id: SeatId,
    readonly subject: SeatSubject,
    readonly serviceId: ServiceId,
  ) {}

  static of(props: SeatProps): Seat {
    return new Seat(props.id, props.subject, props.serviceId);
  }

  isContactless(): boolean {
    return SeatSubject.isContactless(this.subject);
  }
}
