import type { BookingCall } from '@core/components';
import { CouponValue } from '@core/components';
import {
  PipelineError,
  PipelineErrorCode,
  StaffEditErrorCode,
} from '@core/errors';
import type { BookingStatus } from '@core/primitives';
import { AppointmentEditSystem } from '@core/systems';
import type { DayRowVm } from './staff-day.vm';

/*
 * THE SCHEDULE'S SAVE, ITS REFUSALS AND ITS WAY BACK — the rules the
 * page's visit save reads (moved out of staff-dashboard.ts, 2026-11-05, to
 * keep the component under its line budget): what a refusal means, how long
 * an undone save waits, and the stored facts it compares.
 */

/**
 * The stale refusal a write earns on THIS device, before anything is sent:
 * the note or the tip it carries moved under the draft. The server's own
 * stale refusal (`BOOKING_STAFF_EDIT_STALE`) is the same sentence and the
 * same reload, so it is spoken in the server's code.
 */
export function sidesMovedError(): PipelineError {
  return PipelineError.of(
    PipelineErrorCode.InvalidRequest,
    StaffEditErrorCode.Stale,
    null,
    null,
  );
}

/**
 * How long an undone save waits for the listener — for the save to reach
 * the row before the way back is computed, and for the way back to reach
 * it before the sheet re-seeds. The listener delivers in well under a
 * second; this is the ceiling, not the expectation.
 */
export const ROW_WAIT_MS = 5000;

/**
 * Whether a save has a way back through the same callable — the server's
 * rule (`AppointmentEditSystem.undoable`), read on the ROOT appointment's
 * status: a seat added to a FINISHED visit is worked the moment it is
 * written (the after-the-cut flow, owner 2026-09-09) and the server keeps
 * history, so its `removeSeat` would be refused every time and that save's
 * receipt carries no «Отмени» (found in review). The caller hands the root
 * (`DayRowVm.rootBookingStatus`), never the chair's summary (DEP-3).
 *
 * Since OR-4 every save reads it off its own plan
 * (`StaffEditPlanSystem.savePlan`, `reversible` — the same rule on the
 * same root); this is that rule on its own, as the page's specs pin it.
 */
export function reversibleSave(
  root: { readonly bookingStatus: BookingStatus } | null,
  commands: readonly BookingCall.EditCommand[],
): boolean {
  return AppointmentEditSystem.undoable(root?.bookingStatus ?? null, commands);
}

/** How long an undone save gives the busy projection before its one retry. */
export const BUSY_SETTLE_MS = 1500;

/**
 * The server's overlap OFFER — a lost slot naming its own code
 * (`BOOKING_STAFF_EDIT_OVERLAPS`) — as opposed to any other refusal. The
 * store's docblock on `staffEdit` names it; the sheet answers it with
 * «Запази въпреки застъпването», and an undone save answers it with one
 * more try.
 */
export function isOverlapOffer(error: PipelineError | null): boolean {
  return error?.serverErrorCode === StaffEditErrorCode.Overlaps;
}

/**
 * The visit moved on under the sheet — somebody else saved it since the
 * draft was drawn (`BOOKING_STAFF_EDIT_STALE`, round 5). Never retried and
 * never written over: the sheet reloads the visit as it now stands.
 */
export function isStaleRefusal(error: PipelineError | null): boolean {
  return error?.serverErrorCode === StaffEditErrorCode.Stale;
}

/**
 * The stored facts a save can change, as one string — what an undone save
 * compares the live row against to know the server has caught up.
 */
export function rowShape(row: DayRowVm): string {
  return JSON.stringify({
    location: row.locationId,
    // The chair's span on the shop's wall clock (Law 7.3) — its day, its
    // start and its end, as stored.
    day: row.localDate,
    start: row.startMinute,
    end: row.endMinute,
    legs: row.legs.map((leg) => [
      leg.seatId,
      leg.serviceId,
      leg.variantId,
      leg.durationMinutes,
      leg.barberId,
      // The price as cents in its currency, never re-read off a label (D-10.3).
      leg.priceCents,
      leg.currency,
    ]),
    discounts: row.discounts
      .map((discount) =>
        JSON.stringify([
          discount.discountSource,
          discount.grantId,
          discount.code,
          // The value as stored — exactly its variant's fields.
          CouponValue.sliceOf(discount),
        ]),
      )
      .sort(),
    vouchers: row.vouchers.map((voucher) => voucher.code),
    tip: row.tipCents,
  });
}
