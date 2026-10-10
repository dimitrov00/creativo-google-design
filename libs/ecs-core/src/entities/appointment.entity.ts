import type { AppliedDiscount } from '../components/applied-discount.data';
import type { AppliedOperation } from '../components/applied-operation.data';
import type { BookingContact } from '../components/booking-contact.data';
import type { BookingStatus } from '../components/booking-status.data';
import type { BusyKey } from '../components/busy-key.data';
import type { PlacementKind } from '../components/placement-kind.data';
import type { StoodSeatPairs } from '../components/seat-id-pair.data';
import type { Seat } from '../components/seat.data';
import type { TimeInterval } from '../components/time-interval.data';
import type { VoucherRedemption } from '../components/voucher-redemption.data';
import type { BarberId } from './barber.entity';
import type { LocationId } from './location.entity';
import type { UserId } from './user.entity';

export type AppointmentId = string & { readonly __brand: unique symbol };
export const AppointmentId = {
  /** The only cast site. Validate the raw string at the edge, not here. */
  of: (raw: string): AppointmentId => raw as AppointmentId,
} as const;

/**
 * A booked visit — `appointments/{id}` (callable-only in the rules, for
 * everyone, staff included). The stored body of `appointment-document.ts:89-205`
 * plus the two fields no mapper owned (`stoodSeatPairs`, `inferredPlacement`),
 * with exactly the declared changes of blueprint §2.6: `timeSlot` → the
 * `timeInterval` envelope + root `zone`; each seat's slot → `startMs`;
 * `bookedAt`/`arrivedAt` → `*Ms`; `status` → `bookingStatus`; standalone money
 * figures nested as `Money`; `{ iso, zone }` stamps → `*Ms`.
 *
 * The SEATS are the truth. `ownerUserId`, `subjectUserIds`, `barberIds`,
 * `busyKeys` and `timeInterval` are query mirrors, recomputed by every write
 * plan (`AppointmentIndexSystem.queryKeys`), so a corrupt mirror can change
 * which queries find a visit, never what it says. No `party`, `tenantId` or
 * `lineage` is stored: the party is derived, the lineage is
 * `bookedFromAppointmentId`.
 */
export type AppointmentEntity = {
  readonly id: AppointmentId;
  readonly locationId: LocationId;
  /** The `self` seat's account — `null` for a walk-in the shop entered itself. */
  readonly ownerUserId: UserId | null;
  /** Every account on the visit, distinct, sorted — one `array-contains` index. */
  readonly subjectUserIds: readonly UserId[];
  /** The COMMIT's own stamp of who placed the booking; `null` before the field. */
  readonly placement: PlacementKind | null;
  /** The backfill's reconstruction — carried through every rewrite, never promoted. */
  readonly inferredPlacement: PlacementKind | null;
  readonly barberIds: readonly BarberId[];
  /** Each one the `barberBusy` AND the `scheduleExceptions` doc id of a seat's day. */
  readonly busyKeys: readonly BusyKey[];
  /** The envelope — first seat start to last seat end. */
  readonly timeInterval: TimeInterval;
  /** The shop's zone the visit's day keys are resolved in. */
  readonly zone: string;
  readonly bookingStatus: BookingStatus;
  readonly seats: readonly Seat[];
  /** The contact snapshot; `null` for a walk-in with nobody to call. */
  readonly contact: BookingContact | null;
  /**
   * When the booking was made. `null` is a row written before the stamp
   * existed (legacy `bookedAt: null`, `appointment-document.ts:704-707`):
   * its timing figures are derived, not recorded, so it is EXCLUDED from
   * lead-time and late-cancel statistics — never backfilled with an invented
   * instant. Every new write stamps a real `nowMs`.
   */
  readonly bookedAtMs: number | null;
  /** When they walked in — `null` is "not yet", never "on time". */
  readonly arrivedAtMs: number | null;
  /** The rebooking edge — the one fact nothing reconstructs later. */
  readonly bookedFromAppointmentId: AppointmentId | null;
  readonly discounts: readonly AppliedDiscount[];
  readonly voucherRedemptions: readonly VoucherRedemption[];
  /** The optimistic-concurrency counter of staff edits; `0` before the first. */
  readonly revision: number;
  /** The staff-edit ledger, at most `AppliedOperation.CAP` entries. */
  readonly appliedOperations: readonly AppliedOperation[];
  /** The pairs the last staff save broke, for its undo; `null` when none. */
  readonly stoodSeatPairs: StoodSeatPairs | null;
};
