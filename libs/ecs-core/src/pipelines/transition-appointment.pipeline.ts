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
  type GiftVoucher,
  type ShopLocation,
  Collections,
  QueryOp,
} from '@core/entities';
import type {
  AuditAppendPorts,
  PolicyReadPorts,
  ReadTx,
  TelemetryPorts,
  TxPorts,
} from '@core/ports';
import {
  type AuditFact,
  AppointmentLifecycleSystem,
  BusySystem,
  type BusyWrite,
  CancellationPolicySystem,
  ZonedTimeSystem,
} from '@core/systems';
import {
  appendAuditFacts,
  busyMergeWrites,
  type PlacementSet,
  readAppointment,
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
 *   same-day edge, `ShopNow` from its zone), for a cancel the vouchers its
 *   live lines name (runbook §1.3 (4)), for a REINSTATED cancellation
 *   the live appointments sharing a busy key (`busyKeys array-contains ∧
 *   bookingStatus in [PENDING, CONFIRMED]`, index #7): the cancel gave the
 *   chair away and the waitlist may have taken it — the answer is then
 *   honestly "taken" (a `BOOKING_SLOT_UNAVAILABLE` value) — and, for a
 *   visit that is NOT live before the move (only such a move can end it
 *   live), the busy days and exceptions of its seats' keys
 *   (`readPlacementSet`, one `getAll`, absent days read too).
 * - **Plan:** the appointment's variant transition; when the visit ENDS
 *   cancelled, the reversed voucher lines folded into it and each voucher's
 *   restored balance beside it; when it ENDS live from a status that is not
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
 *   (F1-2). Which reopens are REFUSED is unchanged: the #7 check runs only
 *   for a party reinstatement of a cancelled visit.
 * - **Audit:** after the commit, the system's facts
 *   (`transition:<seatId|party>:<decidedAtUtcMs>`). No version CAS — the
 *   status graph refuses a transition already applied (§4.1).
 */

export type TransitionAppointmentCommand = {
  readonly appointmentId: AppointmentId;
  /** One of CONFIRMED, COMPLETED, NO_SHOW, CANCELLED — the edge refuses the rest. */
  readonly to: BookingStatus;
  /** One person's seat, or `null` for the whole party. */
  readonly seatId: SeatId | null;
  /** The cancel's code (`null` for every other verb). */
  readonly reason: CancellationReason | null;
  readonly actor: Actor | null;
};

export type TransitionAppointmentAnswer = {
  readonly appointmentId: AppointmentId;
  readonly to: BookingStatus;
};

export type TransitionAppointmentPorts = TxPorts &
  PolicyReadPorts &
  AuditAppendPorts &
  TelemetryPorts;

type Snapshot = {
  readonly appointment: Appointment | null;
  readonly location: ShopLocation | null;
  readonly vouchers: readonly GiftVoucher[];
  readonly others: readonly Appointment[];
  /** The visit's busy days as read — `null` when the visit was live before the move (nothing to restore). */
  readonly placement: PlacementSet | null;
};

type Decided = {
  readonly auditFacts: readonly AuditFact[];
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
    let windowHours: number | null = null;
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
    // ONE instant per request: the seats are stamped with it and the row is keyed by it.
    const nowUtcMs = ports.nowUtcMs();
    const committed = await ports.commit(
      async (tx): Promise<Snapshot> => {
        const appointment = await readAppointment(tx, cmd.appointmentId);
        if (appointment === null) {
          return {
            appointment,
            location: null,
            vouchers: [],
            others: [],
            placement: null,
          };
        }
        const location = await tx.get<ShopLocation>([
          Collections.Locations,
          appointment.locationId,
        ]);
        const vouchers =
          cmd.to === BookingStatus.Cancelled
            ? await readRedemptionVouchers(tx, appointment.voucherRedemptions)
            : [];
        const others = AppointmentLifecycleSystem.isReinstatement(
          appointment,
          cmd,
        )
          ? await readCollisions(tx, appointment)
          : [];
        // Only a move from a visit that is not live TO a live status may end
        // live (a party or a seat reopen) — the system decides whether it
        // does. Every other move reads no busy day: it pays no extra read, and
        // a malformed busy day never turns its own answer into
        // REPOSITORY_MALFORMED.
        const placement =
          !BookingLifecycle.isLive(appointment) &&
          BookingLifecycle.isLive({ bookingStatus: cmd.to })
            ? await readPlacementSet(tx, busyKeysOf(appointment))
            : null;
        return { appointment, location, vouchers, others, placement };
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
        if (
          AppointmentLifecycleSystem.isReinstatement(appointment, cmd) &&
          AppointmentLifecycleSystem.takenSince(appointment, snapshot.others)
        ) {
          const first = appointment.seats[0] as Seat;
          return Result.err(
            BookingError.slotUnavailable(
              first.barberId,
              appointment.localDate,
              first.startMinutes,
              0,
            ),
          );
        }
        const after = step.value.appointment;
        const writes = AppointmentLifecycleSystem.endsCancelled(
          appointment,
          after,
        )
          ? voucherRestoreWrites(
              step.value.writes,
              appointment.voucherRedemptions,
              snapshot.vouchers,
              nowUtcMs,
            )
          : step.value.writes;
        // The projection's own predicate: what the trigger would restore.
        const endsLive = AppointmentLifecycleSystem.endsLive(
          appointment,
          after,
        );
        return Result.ok({
          auditFacts: step.value.auditFacts,
          writes:
            endsLive && snapshot.placement !== null && zone !== null
              ? [
                  ...writes,
                  ...busyMergeWrites(
                    snapshot.placement,
                    restoredBusyWrites(after),
                    zone,
                  ),
                ]
              : writes,
        });
      },
    );
    if (!committed.ok) return committed;
    await appendAuditFacts(ports, committed.value.auditFacts, cmd.actor);
    return Result.ok({ appointmentId: cmd.appointmentId, to: cmd.to });
  };
