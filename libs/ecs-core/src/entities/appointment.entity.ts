import type { AppliedDiscount } from '../components/applied-discount.data';
import type { AppliedOperation } from '../components/applied-operation.data';
import type { AppointmentTime } from '../components/appointment-time.data';
import type { BookingContact } from '../components/booking-contact.data';
import type { BookingLifecycle } from '../components/booking-lifecycle.data';
import type { Placement } from '../components/placement-kind.data';
import type { StoodSeatPairs } from '../components/seat-id-pair.data';
import type { Seat } from '../components/seat.data';
import type { VoucherRedemption } from '../components/voucher-redemption.data';
import type { BusyKey } from '../primitives/busy-key.primitive';
import type {
  AppointmentId,
  BarberId,
  LocationId,
  UserId,
} from '../primitives/ids.primitive';
import type { UtcEpochMs } from '../primitives/utc-epoch-ms.primitive';

/*
 * F0 STAGING: `AppointmentId` lives in `primitives/ids.primitive.ts` (§1.5);
 * the barrel still names this file for it until the integrator drops that
 * line.
 */

/**
 * The identity slice of a visit — its id and the plain 1-to-1 attributes,
 * plus the true 1-to-N arrays (seats, discounts, voucher lines, the staff
 * ledger, the query mirrors).
 *
 * The SEATS are the truth. `ownerUserId`, `subjectUserIds`, `barberIds`,
 * `busyKeys` and the `AppointmentTime` envelope are query mirrors, recomputed
 * by every write plan (`AppointmentIndexSystem.queryKeys`), so a corrupt
 * mirror can change which queries find a visit, never what it says. No
 * `party`, `tenantId` or `lineage` is stored: the party is derived, the
 * lineage is `bookedFromAppointmentId`.
 */
export type AppointmentMeta = {
  readonly id: AppointmentId;
  readonly locationId: LocationId;
  /**
   * The `SELF` seat's account — `null` for a walk-in the shop entered itself.
   * The rules key (`resource.data.ownerUserId == request.auth.uid`) and the
   * "my appointments" query; it stays a `UserId` beside the
   * `ownerCustomerId` the appointment flip (1) adds (D29, §5.4).
   */
  readonly ownerUserId: UserId | null;
  /**
   * Every account on the visit, distinct, sorted — one `array-contains`
   * index. A `UserId` list until flip (1) replaces it with
   * `subjectCustomerIds` (D29, §5.5).
   */
  readonly subjectUserIds: readonly UserId[];
  /** The COMMIT's own stamp of who placed the booking; `null` before the field. */
  readonly placement: Placement | null;
  /** The backfill's reconstruction — carried through every rewrite, never promoted. */
  readonly inferredPlacement: Placement | null;
  readonly barberIds: readonly BarberId[];
  /** Each one the `barberBusy` AND the `scheduleExceptions` doc id of the visit's day. */
  readonly busyKeys: readonly BusyKey[];
  readonly seats: readonly Seat[];
  /** The rebooking edge — the one fact nothing reconstructs later. */
  readonly bookedFromAppointmentId: AppointmentId | null;
  readonly discounts: readonly AppliedDiscount[];
  readonly voucherRedemptions: readonly VoucherRedemption[];
  /** The optimistic-concurrency counter of staff edits; `0` before the first. */
  readonly revision: number;
  /** The staff-edit ledger, at most `AppliedOperation.CAP` entries. */
  readonly appliedOperations: readonly AppliedOperation[];
};

/**
 * When the booking was made and when the party walked in — two lifecycle
 * instants of the visit itself, outside its booking state machine.
 *
 * `bookedAtUtcMs: null` is a row written before the stamp existed (legacy
 * `bookedAt: null`, `appointment-document.ts:704-707`): its timing figures
 * are derived, not recorded, so it is EXCLUDED from lead-time and
 * late-cancel statistics — never backfilled with an invented instant. Every
 * new write stamps a real instant. `arrivedAtUtcMs: null` is "not yet", never
 * "on time".
 */
export type AppointmentStamps = {
  readonly bookedAtUtcMs: UtcEpochMs | null;
  readonly arrivedAtUtcMs: UtcEpochMs | null;
};

/**
 * A booked visit — `appointments/{id}` (callable-only in the rules, for
 * everyone, staff included). The archetype is the FLAT intersection of its
 * slices (Law 6, flatten-spec §3.2): every 1-to-1 field at the root of the
 * entity and its document — the identity slice, the shop wall clock and the
 * one instant (`AppointmentTime`), the lifecycle variant (`BookingLifecycle`),
 * the contact snapshot (`BookingContact`, all `null` for a walk-in with
 * nobody to call), the two stamps, and the stood-pair memory
 * (`StoodSeatPairs`). The document body is this type minus `id`. No zone: it
 * is the location's (Law 7.2).
 */
export type Appointment = AppointmentMeta &
  AppointmentTime &
  BookingLifecycle &
  BookingContact &
  AppointmentStamps &
  StoodSeatPairs;
