import { ZonedDateTime } from '@creativo/domain/kernel';
import { BarberId, Service } from '@creativo/domain/catalog';
import {
  type BarberDayAvailability,
  BookingCart,
  BookingPolicy,
  CalendarDay,
  type Interval,
  WaitlistRequest,
  availableStarts,
} from '@creativo/domain/scheduling';
import { cartToAvailabilityLines } from '@creativo/application/booking';

/** What one request needs to be matched against a day. */
export interface MatchWaitlistSnapshot {
  readonly zone: string;
  readonly services: readonly Service[];
  readonly barbers: readonly BarberDayAvailability[];
}

export interface WaitlistMatch {
  readonly request: WaitlistRequest;
  readonly day: CalendarDay;
  readonly startMs: number;
  readonly endMs: number;
  readonly barberIds: readonly BarberId[];
}

/**
 * Does anything on this day now fit what this request asked for?
 *
 * ### The same engine, deliberately
 * This runs `availableStarts` with the request's own declared windows as the
 * mask — byte for byte what the browser ran when it told the user there was
 * nothing. Anything else and the notification would be a promise made by a
 * different algorithm from the one that has to honour it at commit time.
 *
 * ### Only the FIRST match matters
 * A notification says "something opened up", not "here are eleven options".
 * The earliest start is the one worth telling someone about, and computing the
 * rest would be work thrown away — the user re-searches live when they open
 * the app anyway, because by then the slot may be gone again.
 *
 * Returns `null` when nothing fits, which is the overwhelmingly common answer:
 * this runs on every change to a barber's day, and most of those are bookings
 * being MADE rather than released.
 */
export function matchWaitlist(
  request: WaitlistRequest,
  day: CalendarDay,
  snapshot: MatchWaitlistSnapshot,
  deps: { readonly now: ZonedDateTime; readonly policy: BookingPolicy },
): WaitlistMatch | null {
  const declared = request.when.for(day);
  if (!declared) return null;

  const cart = BookingCart.reconstitute(request.cart);
  if (cart.isFailure()) return null;

  const barberIds = snapshot.barbers.map((barber) => barber.barberId);
  const lines = cartToAvailabilityLines(
    cart.value,
    snapshot.services,
    barberIds,
  );
  if (lines.length === 0) return null;

  // The same lead-time floor the client applies. Without it a cancellation
  // ten minutes before the slot would notify someone about a time they
  // cannot physically reach, and `commitBooking` would refuse it anyway.
  const notBeforeMs = deps.now.toMillis() + deps.policy.minLeadMinutes * 60_000;

  const withinMs: readonly Interval[] = declared.toIntervals();
  if (withinMs.length === 0) return null;

  const options = availableStarts({
    lines,
    barbers: snapshot.barbers,
    policy: deps.policy,
    notBeforeMs,
    withinMs,
    // One is all a notification can use.
    maxOptions: 1,
  });

  const first = options[0];
  if (!first) return null;

  return {
    request,
    day,
    startMs: first.envelope.startMs,
    endMs: first.envelope.endMs,
    barberIds: first.assignments.map((assignment) => assignment.barberId),
  };
}
