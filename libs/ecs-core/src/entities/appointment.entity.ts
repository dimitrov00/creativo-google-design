import type {
  AppliedDiscount,
  AppliedOperation,
  TimeCoordinate,
  BookingContact,
  BookingLifecycle,
  Placement,
  StoodSeatPairs,
  Seat,
  VoucherRedemption,
} from '@core/components';
import type {
  BusyKey,
  AppointmentId,
  BarberId,
  CustomerId,
  LocationId,
  UserId,
  UtcEpochMs,
} from '@core/primitives';

/**
 * The identity slice of a visit — its id and the plain 1-to-1 attributes,
 * plus the true 1-to-N arrays (seats, discounts, voucher lines, the staff
 * ledger, the query mirrors).
 *
 * The SEATS are the truth. `ownerUserId`, `subjectUserIds`, `barberIds`,
 * `busyKeys`, the client-record mirrors (`AppointmentClientRefs`) and the
 * `TimeCoordinate` envelope are query mirrors, recomputed by every write
 * plan (`AppointmentIndexSystem.queryKeys`), so a corrupt mirror can change
 * which queries find a visit, never what it says. No `party`, `tenantId`
 * or `lineage` is stored: the party is derived, the lineage is
 * `bookedFromAppointmentId`.
 */
export type AppointmentMeta = {
  readonly id: AppointmentId;
  readonly locationId: LocationId;
  /**
   * The `SELF` seat's account — `null` for a walk-in the shop entered itself.
   * The rules key (`resource.data.ownerUserId == request.auth.uid`) and the
   * "my appointments" query (#6, #18): an ACCOUNT key for good, beside the
   * `ownerCustomerId` of {@link AppointmentClientRefs} (D29, F1-4).
   */
  readonly ownerUserId: UserId | null;
  /**
   * Every account on the visit, distinct, sorted — kept beside
   * `subjectCustomerIds` (D29, F1-4); no query and no rule reads it after
   * flip (1) (a `fieldOverrides` entry switches its index off).
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
 * The visit's CLIENT-RECORD mirrors (D29, flatten-spec §5.4, F1-4) — whom
 * the shop served, beside the account keys of {@link AppointmentMeta}:
 * derived from the seats' `subjectCustomerId` by every write plan
 * (`AppointmentIndexSystem.queryKeys`), never from a uid's text.
 */
export type AppointmentClientRefs = {
  /** The `SELF` seat's client record — `null` exactly when `ownerUserId` is. */
  readonly ownerCustomerId: CustomerId | null;
  /**
   * Every client record on the visit, distinct, sorted — the client card's
   * history (`subjectCustomerIds array-contains`, `utcEpochMs desc`, index
   * #19) and the stats projection's read set.
   */
  readonly subjectCustomerIds: readonly CustomerId[];
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
 * entity and its document — the identity slice, the client-record mirrors
 * (`AppointmentClientRefs`, D29), the shop wall clock and the one instant
 * (`TimeCoordinate`), the lifecycle variant (`BookingLifecycle`), the
 * contact snapshot (`BookingContact`, all `null` for a walk-in with nobody
 * to call), the two stamps, and the stood-pair memory (`StoodSeatPairs`).
 * The document body is this type minus `id`. No zone: it is the location's
 * (Law 7.2).
 */
export type Appointment = AppointmentMeta &
  AppointmentClientRefs &
  TimeCoordinate &
  BookingLifecycle &
  BookingContact &
  AppointmentStamps &
  StoodSeatPairs;
