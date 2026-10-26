import {
  type Actor,
  BookingLifecycle,
  type CancellationReason,
  type Seat,
  type ShopNow,
  type WriteOp,
} from '@core/components';
import {
  BookingStatus,
  type BusyKey,
  type HourCount,
  type OperationId,
  Result,
  type AppointmentId,
  type SeatId,
  TimeZone,
  type UtcEpochMs,
} from '@core/primitives';
import {
  BookingError,
  SchedulingError,
  type TransitionAppointmentError,
} from '@core/errors';
import {
  type Appointment,
  type CouponGrant,
  type GiftVoucher,
  type ShopLocation,
  Collections,
  QueryOp,
} from '@core/entities';
import type {
  PolicyReadPorts,
  ReadTx,
  TelemetryPorts,
  TxPorts,
} from '@core/ports';
import {
  type AuditFact,
  AppointmentLifecycleSystem,
  AuditSystem,
  BillingSystem,
  BusySystem,
  type BusyWrite,
  CancellationPolicySystem,
  ZonedTimeSystem,
} from '@core/systems';
import {
  busyMergeWrites,
  grantReleaseWrites,
  logUnaudited,
  type PlacementSet,
  readAppointment,
  readDiscountGrants,
  readPlacementSet,
  readRedemptionVouchers,
  voucherRestoreWrites,
  zoneOf,
} from './booking-read-set.pipeline';

/**
 * `transitionAppointment` — the SHOP's lifecycle pen (blueprint §4.1):
 * confirm, complete, no-show and the shop's own cancel, of ONE seat or of
 * the whole party, plus the correction edges the graph allows the shop
 * (`NO_SHOW → CONFIRMED`; `COMPLETED`/`CANCELLED → CONFIRMED` on the
 * visit's own day only). The decision is
 * `AppointmentLifecycleSystem.transition`, never re-encoded.
 *
 * - **No cancellation window here** — the shop may always clear its own
 *   book. The window is still READ for a cancel (outside the transaction),
 *   because it is STAMPED on the seats it closes; a failed read stamps
 *   UNKNOWN (`null`) and logs a warning — it never refuses the shop's cancel.
 * - **Read set:** the visit, its location (the shop's "today" for the
 *   same-day edge, `ShopNow` from its zone), for a move that may release
 *   the visit's holdings (`BillingSystem.releasesHoldings` on the status it
 *   asks for: a cancel or a no-show of a visit that had not already ended
 *   so) the vouchers its live lines name (runbook §1.3 (4)) and the coupon
 *   grants its bill's grant lines name (`readDiscountGrants`, OR-13 — no
 *   line, no read), and for a move that may END the visit live
 *   (`AppointmentLifecycleSystem.mayEndLive`: a move to a live status of a
 *   visit that is not live — the reopen of a `CANCELLED`, `NO_SHOW` or
 *   `COMPLETED` visit) the live appointments sharing a busy key
 *   (`busyKeys array-contains ∧ bookingStatus in [PENDING, CONFIRMED]`,
 *   index #7) — leaving the book freed the chair, and a booking, the
 *   waitlist or a staff move may have taken it since — and the busy days
 *   and exceptions of its seats' keys (`readPlacementSet`, one `getAll`,
 *   absent days read too).
 * - **Refusal:** a move that ends the visit live while an open seat it puts
 *   back collides with an open seat of a live visit booked into that chair
 *   since is honestly "taken" — `SCHEDULING_APPOINTMENT_REOPEN_SLOT_TAKEN`,
 *   naming the status it left and that seat (the edge's
 *   `BOOKING_TRANSITION_SLOT_TAKEN`) — and writes nothing
 *   (`AppointmentLifecycleSystem.seatTakenSince`; OR-57, pass E N-5: every
 *   reopen, not only a cancelled party's).
 * - **Plan:** the appointment's variant transition; when the move releases
 *   the visit's holdings — it ENDS cancelled or no-show from a status that
 *   did not (OR-13, DEP-F10b: value the client holds is consumed only by a
 *   visit that happened) — the reversed voucher lines and the bill with its
 *   grant lines dropped folded into it, each voucher's restored balance and
 *   each grant's restore beside it (a completed visit keeps what it spent;
 *   a reopen re-burns nothing — the barber re-adds the reward or the
 *   voucher); when it ENDS live from a status that is not
 *   (`AppointmentLifecycleSystem.endsLive` — the busy projection's own
 *   predicate: the reopen of a `CANCELLED`,
 *   `NO_SHOW` or `COMPLETED` visit), its seats' chair time
 *   (`BusySystem.contributionsOf`, what `BusySystem.rebuild` restores)
 *   merged onto the EXACT busy bodies this attempt read (`busyMergeWrites`,
 *   as a booking does) — the chair is held at once, not only once
 *   `rebuildBusy` ran, so no booking is admitted over it in between (pass E,
 *   E-14, DEP-5). The trigger's recompute lands on the same document. A shop
 *   whose zone cannot be read gets no busy day (its first instant is the
 *   zone's, Law 7.2 — the rebuild cannot stamp one either). Every other
 *   edge writes no busy day — occupancy leaves through `rebuildBusy`
 *   (F1-2).
 * - **Audit:** the system's facts, `Create`d LAST in the SAME plan (WS-1 —
 *   they land with the move or not at all), keyed by the act's operation id
 *   (`transition:<operationId>` for the party, `…:<seatId>` for one seat).
 *   No version CAS — the status graph refuses a transition already applied
 *   (§4.1), so a replay never reaches its own row (RU-4).
 */

export type TransitionAppointmentCommand = {
  readonly appointmentId: AppointmentId;
  /** One of CONFIRMED, COMPLETED, NO_SHOW, CANCELLED — the edge refuses the rest. */
  readonly to: BookingStatus;
  /** One person's seat, or `null` for the whole party. */
  readonly seatId: SeatId | null;
  /** The cancel's code (`null` for every other verb). */
  readonly reason: CancellationReason | null;
  /** The act's operation id — the client-minted name of this ONE act, REQUIRED (WS-4.1). */
  readonly operationId: OperationId;
  readonly actor: Actor | null;
};

export type TransitionAppointmentAnswer = {
  readonly appointmentId: AppointmentId;
  readonly to: BookingStatus;
};

export type TransitionAppointmentPorts = TxPorts &
  PolicyReadPorts &
  TelemetryPorts;

type Snapshot = {
  readonly appointment: Appointment | null;
  readonly location: ShopLocation | null;
  readonly vouchers: readonly GiftVoucher[];
  readonly grants: readonly CouponGrant[];
  readonly others: readonly Appointment[];
  /** The visit's busy days as read — `null` when the visit was live before the move (nothing to restore). */
  readonly placement: PlacementSet | null;
};

type Decided = {
  /** The facts no row was planned for: no verified actor. */
  readonly unaudited: readonly AuditFact[];
  readonly writes: readonly WriteOp[];
};

/** Every live appointment sharing one of the visit's busy keys — one query per key (#7). */
async function readCollisions(
  tx: ReadTx,
  appointment: Appointment,
): Promise<readonly Appointment[]> {
  const others: Appointment[] = [];
  for (const key of appointment.busyKeys) {
    const found = await tx.query<Appointment>({
      collection: [Collections.Appointments],
      where: [
        { field: 'busyKeys', op: QueryOp.ArrayContains, value: key },
        {
          field: 'bookingStatus',
          op: QueryOp.In,
          value: BookingLifecycle.LIVE_STATUSES,
        },
      ],
      orderBy: [],
      limit: null,
    });
    others.push(...found);
  }
  return others;
}

/** A shop that cannot be read, or whose stored zone is no zone, has none. */
function zoneOfShop(location: ShopLocation | null): TimeZone | null {
  return location === null ? null : zoneOf(location);
}

/** A visit whose shop has no zone keeps no shop clock: never "today" (the settled stay settled). */
function shopNowOf(
  zone: TimeZone | null,
  nowUtcMs: UtcEpochMs,
): ShopNow | null {
  return zone === null ? null : ZonedTimeSystem.shopNow(nowUtcMs, zone);
}

/**
 * The busy days a visit's seats occupy — one key per barber on its shop day
 * (`BusySystem.contributionsOf`), the keys {@link restoredBusyWrites} writes.
 * A lifecycle move never moves a seat, so the keys read on the side before
 * the move are the keys the side after it writes.
 */
function busyKeysOf(appointment: Appointment): readonly BusyKey[] {
  const keys: BusyKey[] = [];
  for (const share of BusySystem.contributionsOf(appointment)) {
    keys.push(share.id);
  }
  return keys;
}

/** The visit's chair time as `busyMergeWrites` takes it — every span of every share, as the projection renders it. */
function restoredBusyWrites(appointment: Appointment): readonly BusyWrite[] {
  const writes: BusyWrite[] = [];
  for (const share of BusySystem.contributionsOf(appointment)) {
    for (const span of share.spans) {
      writes.push({
        barberId: share.barberId,
        localDate: share.localDate,
        startMinutes: span.startMinutes,
        endMinutes: span.endMinutes,
      });
    }
  }
  return writes;
}

export const transitionAppointment =
  (ports: TransitionAppointmentPorts) =>
  async (
    cmd: TransitionAppointmentCommand,
  ): Promise<
    Result<TransitionAppointmentAnswer, TransitionAppointmentError>
  > => {
    let windowHours: HourCount | null = null;
    if (cmd.to === BookingStatus.Cancelled) {
      const policy = await ports.loadPolicy();
      if (policy.ok) {
        windowHours = CancellationPolicySystem.stampOf(policy.value);
      } else {
        ports.log('warn', 'cancellation window unread; stamped unknown', {
          resourceId: cmd.appointmentId,
          error: policy.error.reason,
        });
      }
    }
    // ONE instant per request, read before the transaction: the seats and
    // the rows are stamped with it — a contention re-run of `decide` derives
    // the same plan, row ids included.
    const nowUtcMs = ports.nowUtcMs();
    const committed = await ports.commit(
      async (tx): Promise<Snapshot> => {
        const appointment = await readAppointment(tx, cmd.appointmentId);
        if (appointment === null) {
          return {
            appointment,
            location: null,
            vouchers: [],
            grants: [],
            others: [],
            placement: null,
          };
        }
        const location = await tx.get<ShopLocation>([
          Collections.Locations,
          appointment.locationId,
        ]);
        // What the visit holds is read only for a move that may give it back
        // — the decision below asks the same predicate of the status the
        // move actually ends in.
        const releases = BillingSystem.releasesHoldings(appointment, {
          bookingStatus: cmd.to,
        });
        const vouchers = releases
          ? await readRedemptionVouchers(tx, appointment.voucherRedemptions)
          : [];
        const grants = releases
          ? await readDiscountGrants(tx, appointment.discounts)
          : [];
        // Only a move that may end the visit live reopens a chair the busy
        // projection freed: it reads who has booked into it since (#7) and the
        // busy days it would hold again — the system decides whether it does.
        // Every other move reads neither: it pays no extra read, and a
        // malformed busy day never turns its own answer into
        // REPOSITORY_MALFORMED.
        const reopens = AppointmentLifecycleSystem.mayEndLive(appointment, cmd);
        const others = reopens ? await readCollisions(tx, appointment) : [];
        const placement = reopens
          ? await readPlacementSet(tx, busyKeysOf(appointment))
          : null;
        return {
          appointment,
          location,
          vouchers,
          grants,
          others,
          placement,
        };
      },
      (snapshot): Result<Decided, TransitionAppointmentError> => {
        const appointment = snapshot.appointment;
        if (appointment === null) {
          return Result.err(BookingError.invalidInput('appointmentId'));
        }
        const request = {
          to: cmd.to,
          seatId: cmd.seatId,
          reason: cmd.reason,
          windowHours,
          operationId: cmd.operationId,
        };
        const zone = zoneOfShop(snapshot.location);
        const now = shopNowOf(zone, nowUtcMs);
        if (
          now === null &&
          AppointmentLifecycleSystem.readsShopToday(appointment, cmd)
        ) {
          // No shop clock, no "same day": the settled visit stays settled.
          return Result.err(
            SchedulingError.appointmentReopenWindowClosed(
              appointment.bookingStatus,
            ),
          );
        }
        // Every other verb reads only the instant of `now`: without a shop
        // clock it is read on UTC's, which no answer depends on.
        const step = AppointmentLifecycleSystem.transition(
          appointment,
          request,
          now ?? ZonedTimeSystem.shopNow(nowUtcMs, TimeZone.UTC),
        );
        if (!step.ok) return step;
        const after = step.value.appointment;
        // The projection's own predicate: what the trigger would restore —
        // a chair the reopen holds again only while nobody took it since.
        const endsLive = AppointmentLifecycleSystem.endsLive(
          appointment,
          after,
        );
        const taken = endsLive
          ? AppointmentLifecycleSystem.seatTakenSince(after, snapshot.others)
          : null;
        if (taken !== null) {
          const seat = after.seats[taken] as Seat;
          return Result.err(
            SchedulingError.appointmentReopenSlotTaken(
              appointment.bookingStatus,
              seat.barberId,
              after.localDate,
              seat.startMinutes,
              taken,
            ),
          );
        }
        const writes = BillingSystem.releasesHoldings(appointment, after)
          ? grantReleaseWrites(
              voucherRestoreWrites(
                step.value.writes,
                appointment.voucherRedemptions,
                snapshot.vouchers,
                nowUtcMs,
              ),
              appointment.discounts,
              snapshot.grants,
            )
          : step.value.writes;
        const audit = AuditSystem.commitWrites(
          step.value.auditFacts,
          cmd.actor,
          nowUtcMs,
          ports.hash,
        );
        return Result.ok({
          unaudited: audit.unaudited,
          writes:
            endsLive && snapshot.placement !== null && zone !== null
              ? [
                  ...writes,
                  ...busyMergeWrites(
                    snapshot.placement,
                    restoredBusyWrites(after),
                    zone,
                  ),
                  ...audit.writes,
                ]
              : [...writes, ...audit.writes],
        });
      },
    );
    if (!committed.ok) return committed;
    logUnaudited(ports, committed.value.unaudited);
    return Result.ok({ appointmentId: cmd.appointmentId, to: cmd.to });
  };
