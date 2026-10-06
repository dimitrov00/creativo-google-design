import { ZonedDateTime } from '@creativo/domain/kernel';
import { BarberId, LocationId, Service } from '@creativo/domain/catalog';
import {
  type AvailabilityAssignment,
  type BarberDayAvailability,
  BookingCart,
  BookingPolicy,
  CalendarDay,
  type Interval,
  WaitlistRequest,
  windowsAt,
} from '@creativo/domain/scheduling';
import {
  cartToAvailabilityLines,
  optionsForDay,
  partyServicesOf,
} from '@creativo/application/booking';
import { cartAdmissible } from './party-admission';

/** What one request needs to be matched against a day. */
export interface MatchWaitlistSnapshot {
  readonly zone: string;
  readonly services: readonly Service[];
  /**
   * Every barber rostered on the day, at EVERY active shop, with `busy`
   * already padded by their turnaround (`BarberDayAvailability.busy`,
   * `paddedBusy`) — exactly what the grid's reader hands the engine. Their
   * windows are at LISTED shops only (`toShop`, `shopListed`,
   * `loadDayAvailability`): a shop hidden since holds none, so nothing here
   * is searched there. A day with nothing to search has no barbers at all.
   */
  readonly barbers: readonly BarberDayAvailability[];
}

export interface WaitlistMatch {
  readonly request: WaitlistRequest;
  readonly day: CalendarDay;
  /**
   * The ONE shop the whole party is placed at. An appointment holds one
   * `locationId`, so a match is always single-shop, and for a request that
   * named a shop it is that shop.
   */
  readonly locationId: LocationId;
  readonly startMs: number;
  readonly endMs: number;
  readonly barberIds: readonly BarberId[];
  /**
   * Who sits where and when — the arrangement the promise is about, line by
   * line, exactly as the grid would hand it to the review step. It is what a
   * commit of this match is built from.
   */
  readonly assignments: readonly AvailabilityAssignment[];
}

/**
 * Does anything on this day now fit what this request asked for?
 *
 * ### A notification is a promise, so it is the grid's answer
 * It may name only a start `commitBooking` would accept for this request right
 * then. So this asks the question the booking grid asks, through the same
 * functions (`ObserveDayAvailabilityUseCase` → `optionsForDay`), with the
 * request's own declared windows as the mask:
 *
 * - **One shop per party.** `optionsForDay` partitions the pool by the shop
 *   on each barber's windows and runs the engine once per shop. A mixed pool
 *   seated a father at Center and his son at Mladost at the same time — an
 *   appointment holds one `locationId`, so that promise could never be kept.
 * - **The service offered there.** It runs only the shops that serve every
 *   seat (`shopsServingParty`, the rule `decideBooking` refuses
 *   `service_not_at_location` by).
 * - **The shop the request named.** Narrowed with `windowsAt`, as the grid's
 *   reader narrows its read, so a barber's hours at another shop are not
 *   offered and the other shops' searches are not paid for.
 * - **A shop still listed.** The request's shop passed the waitlist's shop
 *   rule when it was made (`shopListed`, `decideWaitlist`). A shop hidden
 *   since holds no windows in the snapshot, so a request naming it finds
 *   nothing and is SKIPPED, not closed. It stays `open`, for three reasons:
 *   `hidden` can be undone (`LocationStatus`); no status means "shop gone"
 *   (`expired` means every day has passed); and catalogue drift is skipped
 *   the same way below. It lapses by its own days like every request: the
 *   trigger's lapse check runs on a day with nothing to search as well,
 *   because `loadDayAvailability` returns an empty day there, never
 *   `null`. An "any shop" request is never searched at a hidden shop
 *   either.
 * - **The barber's turnaround** is in `snapshot.barbers[].busy` already
 *   (`loadDayAvailability`, `paddedBusy`), and the barber preference rides on
 *   each line (`cartToAvailabilityLines`).
 * - **The lead time and the horizon** are the policy's own, as the commit
 *   applies them.
 * - **The whole party, as the commit admits it.** Every refusal the commit
 *   makes whatever the time — a retired service, a variant the service now
 *   requires, services that now conflict, a party over the cap, a service
 *   the named shop no longer offers — is asked first, through the commit's
 *   own checks (`cartAdmissible`): catalogue drift since the request is
 *   never a promise.
 *
 * ### Only ONE match matters
 * A notification says "something opened up", not "here are eleven options".
 * So each shop's search stops at the first arrangement the engine finds
 * (`maxOptions: 1`), and the earliest of those across shops is the one named.
 * That is not always the day's earliest start (the engine walks barber by
 * barber), but it is always one the commit accepts, and computing the rest
 * would be work thrown away — the user re-searches live when they open the
 * app anyway, because by then the slot may be gone again.
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

  // Past the booking horizon the commit refuses every start
  // (`beyond_horizon`). The request was inside it when it was made, but the
  // shop can shorten its horizon since, and the promise is judged now.
  const horizonEnd = deps.policy.horizonEndFrom(
    CalendarDay.fromZonedDateTime(deps.now),
  );
  if (horizonEnd.isBefore(day)) return null;

  const cart = BookingCart.reconstitute(request.cart);
  if (cart.isFailure()) return null;

  // THE PARTY AS THE COMMIT WOULD ADMIT IT NOW, whatever the time — the
  // commit's own checks (`cartAdmissible`, round 6). The request passed
  // them when it was made; the catalogue can change since: a service
  // retired, one that gained variants (the commit refuses a line with none
  // chosen), two services that now conflict, a party cap the owner lowered,
  // a service the named shop stopped offering. Any of these refuses every
  // start, so no start is a promise.
  const admissible = cartAdmissible(
    cart.value,
    snapshot.services,
    deps.policy,
    request.locationId,
  );
  if (admissible.isFailure()) return null;

  // The shop the request named, narrowed the way the grid's reader narrows
  // (`AvailabilityReader.observeDay`): its windows only, and a barber with
  // none there is not in the pool at all. `null` is "any shop", where every
  // shop stays a candidate and `optionsForDay` keeps each run to one.
  const shop = request.locationId;
  const barbers = shop
    ? snapshot.barbers.flatMap((barber): readonly BarberDayAvailability[] => {
        const windows = windowsAt(barber.windows, shop);
        return windows.length === 0 ? [] : [{ ...barber, windows }];
      })
    : snapshot.barbers;
  if (barbers.length === 0) return null;

  // The whole party: `cartToAvailabilityLines` drops a line whose service
  // left the catalogue, and the admission above has already refused any
  // such cart (`unknown_service`), so every line is here.
  const lines = cartToAvailabilityLines(
    cart.value,
    snapshot.services,
    barbers.map((barber) => barber.barberId),
  );

  // The same lead-time floor the client applies. Without it a cancellation
  // ten minutes before the slot would notify someone about a time they
  // cannot physically reach, and `commitBooking` would refuse it anyway.
  const notBeforeMs = deps.now.toMillis() + deps.policy.minLeadMinutes * 60_000;

  const withinMs: readonly Interval[] = declared.toIntervals();
  if (withinMs.length === 0) return null;

  const options = optionsForDay({
    lines,
    services: snapshot.services,
    party: partyServicesOf(cart.value),
    barbers,
    policy: deps.policy,
    notBeforeMs,
    withinMs,
    // One per shop is all a notification can use; the options come back
    // sorted by start across shops.
    maxOptions: 1,
  });

  const first = options[0];
  if (!first) return null;

  return {
    request,
    day,
    locationId: first.locationId,
    startMs: first.option.envelope.startMs,
    endMs: first.option.envelope.endMs,
    barberIds: first.option.assignments.map(
      (assignment) => assignment.barberId,
    ),
    assignments: first.option.assignments,
  };
}
