import {
  type AppliedDiscount,
  BookingLifecycle,
  type CancellationDelta,
  type RescheduleDelta,
  type Seat,
  StaffEditDelta,
  type TipDelta,
  type TransitionDelta,
  VoucherRedemption,
} from '@core/components';
import {
  type AppliedDiscountId,
  type AttendanceState,
  type BarberId,
  type Currency,
  defect,
  DurationMinutes,
  PriceCents,
  type SeatId,
} from '@core/primitives';
import type { Appointment } from '@core/entities';
import { BillingSystem } from './billing.system';

/** The barbers of `seats` in seat order, duplicates kept (positional). */
function barberIdsOf(seats: readonly Seat[]): BarberId[] {
  const out: BarberId[] = [];
  for (let i = 0; i < seats.length; i++) out.push((seats[i] as Seat).barberId);
  return out;
}

/** The applied discounts' ids, in stored order. */
function discountIdsOf(
  discounts: readonly AppliedDiscount[],
): AppliedDiscountId[] {
  const out: AppliedDiscountId[] = [];
  for (let i = 0; i < discounts.length; i++) {
    out.push((discounts[i] as AppliedDiscount).discountId);
  }
  return out;
}

/** Equal element by element, in order. */
function samePositions<T>(a: readonly T[], b: readonly T[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Equal as multisets — sorted copies (code-unit order), compared in place. */
function sameMembers(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  return samePositions([...a].sort(), [...b].sort());
}

/**
 * One key per LIVE voucher line — which voucher, how much, in what — so a
 * reversal, a new line or a re-priced line all read as "the lines changed".
 * The voucher id only: never its code (R36).
 */
function liveLineKeys(redemptions: readonly VoucherRedemption[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < redemptions.length; i++) {
    const line = redemptions[i] as VoucherRedemption;
    if (VoucherRedemption.isLive(line)) {
      out.push(`${line.voucherId}|${line.amountCents}|${line.currency}`);
    }
  }
  return out;
}

/** The seats' sold minutes summed; `null` for a visit with no seat. */
function soldMinutesOf(seats: readonly Seat[]): DurationMinutes | null {
  let total: DurationMinutes | null = null;
  for (let i = 0; i < seats.length; i++) {
    const minutes = (seats[i] as Seat).durationMinutes;
    total = total === null ? minutes : DurationMinutes.sum(total, minutes);
  }
  return total;
}

/** The seat `seatId` of `seats`, or `null`. */
function seatIn(seats: readonly Seat[], seatId: SeatId): Seat | null {
  for (let i = 0; i < seats.length; i++) {
    const seat = seats[i] as Seat;
    if (seat.seatId === seatId) return seat;
  }
  return null;
}

/**
 * The before / after values an audit row carries (audit-hardening WS-2) —
 * pure and total, computed inside the act's decide step from the entities
 * its transaction already read: ZERO extra reads. Money, time and ids only;
 * never a voucher code, a discount label or a contact value (R36). The
 * bill figures reuse `BillingSystem` (`subtotalOf`, `redeemedOf`), never a
 * second sum.
 */
export const AuditDeltaSystem = {
  /**
   * Where a client's move took the visit: the day, the start and the shop
   * on each side, and the barbers in seat order (positional — a move re-ids
   * its cart seats, so nothing is aligned by id).
   */
  rescheduled(before: Appointment, after: Appointment): RescheduleDelta {
    return {
      rescheduleFromLocalDate: before.localDate,
      rescheduleToLocalDate: after.localDate,
      rescheduleFromStartMinutes: before.startMinutes,
      rescheduleToStartMinutes: after.startMinutes,
      rescheduleFromBarberIds: barberIdsOf(before.seats),
      rescheduleToBarberIds: barberIdsOf(after.seats),
      rescheduleFromLocationId: before.locationId,
      rescheduleToLocationId: after.locationId,
    };
  },

  /**
   * What a staff save changed, stored visit against saved visit — each
   * dimension's pair `null` when it did not change, and
   * {@link StaffEditDelta.NONE} itself when none did. The subtotal pair is
   * `null` too when either side has no single-currency subtotal (mixed or
   * empty seats — never a defect), or the two sides bill in different
   * currencies; the voucher debit is read in the saved bill's currency (the
   * stored one's when the saved bill has none) and is `null` without one.
   */
  staffEdit(before: Appointment, after: Appointment): StaffEditDelta {
    const fromBill = BillingSystem.subtotalOf(before.seats);
    const toBill = BillingSystem.subtotalOf(after.seats);
    const currency: Currency | null = toBill.ok
      ? toBill.value.currency
      : fromBill.ok
        ? fromBill.value.currency
        : null;
    const repriced =
      fromBill.ok &&
      toBill.ok &&
      fromBill.value.currency === toBill.value.currency &&
      fromBill.value.amountCents !== toBill.value.amountCents;

    const linesChanged = !sameMembers(
      liveLineKeys(before.voucherRedemptions),
      liveLineKeys(after.voucherRedemptions),
    );
    const voucherDebit =
      linesChanged && currency !== null
        ? PriceCents.sub(
            BillingSystem.redeemedOf(after.voucherRedemptions, currency)
              .amountCents,
            BillingSystem.redeemedOf(before.voucherRedemptions, currency)
              .amountCents,
          )
        : null;

    const fromDiscounts = discountIdsOf(before.discounts);
    const toDiscounts = discountIdsOf(after.discounts);
    const discounted = !sameMembers(fromDiscounts, toDiscounts);

    const fromMinutes = soldMinutesOf(before.seats);
    const toMinutes = soldMinutesOf(after.seats);
    const redurated = fromMinutes !== toMinutes;

    const relocated = before.locationId !== after.locationId;
    const moved =
      before.localDate !== after.localDate ||
      before.startMinutes !== after.startMinutes;

    const fromBarbers = barberIdsOf(before.seats);
    const toBarbers = barberIdsOf(after.seats);
    const restaffed = !samePositions(fromBarbers, toBarbers);

    if (
      !repriced &&
      voucherDebit === null &&
      !discounted &&
      !redurated &&
      !relocated &&
      !moved &&
      !restaffed
    ) {
      return StaffEditDelta.NONE;
    }
    return {
      editRepriceFromCents:
        repriced && fromBill.ok ? fromBill.value.amountCents : null,
      editRepriceToCents:
        repriced && toBill.ok ? toBill.value.amountCents : null,
      editCurrency: repriced || voucherDebit !== null ? currency : null,
      editDiscountFromIds: discounted ? fromDiscounts : null,
      editDiscountIds: discounted ? toDiscounts : null,
      editVoucherDebitCents: voucherDebit,
      editDurationFromMinutes: redurated ? fromMinutes : null,
      editDurationToMinutes: redurated ? toMinutes : null,
      editRelocateFromLocationId: relocated ? before.locationId : null,
      editRelocateToLocationId: relocated ? after.locationId : null,
      editMoveFromLocalDate: moved ? before.localDate : null,
      editMoveToLocalDate: moved ? after.localDate : null,
      editMoveFromStartMinutes: moved ? before.startMinutes : null,
      editMoveToStartMinutes: moved ? after.startMinutes : null,
      editRestaffFromBarberIds: restaffed ? fromBarbers : null,
      editRestaffToBarberIds: restaffed ? toBarbers : null,
    };
  },

  /**
   * One seat's tip, before and after (`null` — "not recorded", never zero),
   * in that seat's currency as it stands after the act.
   */
  tip(before: Seat, after: Seat): TipDelta {
    return {
      tipAmountCents: after.tipCents,
      tipFromCents: before.tipCents,
      tipCurrency: after.currency,
    };
  },

  /**
   * {@link tip} on the seat `seatId` of the seats before and after the act —
   * the tip pipeline's door. The act already refused an unknown seat
   * (`BillingSystem.recordTip`), so a missing one here is a defect.
   */
  tipOnSeat(
    before: readonly Seat[],
    after: readonly Seat[],
    seatId: SeatId,
  ): TipDelta {
    const was = seatIn(before, seatId);
    const now = seatIn(after, seatId);
    if (was === null || now === null) {
      return defect('a tip delta on a seat the visit does not hold');
    }
    return AuditDeltaSystem.tip(was, now);
  },

  /**
   * What a staff lifecycle verb leaves: the root state and its entering
   * stamp, and — for a one-seat act (`seatId`) — that seat's attendance;
   * `null` for a party act (or a seat the visit does not hold).
   */
  transitioned(before: Appointment, seatId: SeatId | null): TransitionDelta {
    let attendance: AttendanceState | null = null;
    if (seatId !== null) {
      const seat = seatIn(before.seats, seatId);
      attendance = seat === null ? null : seat.attendanceState;
    }
    return {
      transitionFromBookingStatus: before.bookingStatus,
      transitionFromStatusAtUtcMs: BookingLifecycle.enteredAtUtcMs(before),
      transitionFromAttendanceState: attendance,
    };
  },

  /** What a client's own cancel leaves: the root state and its entering stamp. */
  cancelled(before: Appointment): CancellationDelta {
    return {
      cancellationFromBookingStatus: before.bookingStatus,
      cancellationFromStatusAtUtcMs: BookingLifecycle.enteredAtUtcMs(before),
    };
  },
} as const;
