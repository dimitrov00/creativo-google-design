import type { Result, ZonedDateTime } from '@creativo/domain/kernel';
import {
  BarberId,
  LocationId,
  type Service,
  type ServiceTerms,
} from '@creativo/domain/catalog';
import {
  type AvailabilityAssignment,
  type BarberDayAvailability,
  BookingCart,
  type BookingPolicy,
  type CalendarDay,
  type FlexibleWhen,
  Interval,
  type WaitlistRequest,
} from '@creativo/domain/scheduling';
import {
  BarberId as BarberKey,
  CartLineId as LineKey,
  Currency,
  DurationMinutes,
  EndMinute,
  LocalDate,
  LocationId as LocationKey,
  MinuteCount,
  MinuteOfDay,
  PriceCents,
  SeatKeyText,
  ServiceId as ServiceKey,
  ServiceVariantId as VariantKey,
  type TimeZone,
  UtcEpochMs,
  WaitlistRequestId,
  defect,
} from '@core/primitives';
import {
  type BookingCart as CartData,
  type BookingPolicy as PolicyData,
  DayWindows as DayWindowsData,
  FlexibleWhen as WhenData,
  MinuteRange,
  RosterWindow,
  ServiceTerms as TermsData,
  type ShopNow,
} from '@core/components';
import {
  type CartBarberDay,
  type CartService,
  WaitlistSystem,
  ZonedTimeSystem,
} from '@core/systems';
import { cartAdmissible } from './party-admission';

/*
 * THIN SHIM (ECS migration Phase 2). The matcher is `WaitlistSystem.match`
 * (the grid's own day search, `BookingCartSystem.optionsForDay`, over the
 * request's declared windows); the commit's admission (`cartAdmissible`) is
 * handed to it as a verdict. This file keeps the legacy signature and only
 * converts the legacy classes to the ECS structs and the match back: the
 * legacy instants onto the shop day's wall clock with the snapshot's zone
 * (`ZonedTimeSystem.toLocal`), and the match's minutes back to instants
 * (`ZonedTimeSystem.toUtc`) — the one boundary that touches the zone.
 */

/** What one request needs to be matched against a day. */
export interface MatchWaitlistSnapshot {
  readonly zone: string;
  readonly services: readonly Service[];
  /**
   * Every barber rostered on the day, at EVERY listed shop, with `busy`
   * already padded by their turnaround — exactly what the grid's reader hands
   * the engine. A day with nothing to search has no barbers at all.
   */
  readonly barbers: readonly BarberDayAvailability[];
}

export interface WaitlistMatch {
  readonly request: WaitlistRequest;
  readonly day: CalendarDay;
  /** The ONE shop the whole party is placed at. */
  readonly locationId: LocationId;
  readonly startMs: number;
  readonly endMs: number;
  readonly barberIds: readonly BarberId[];
  /** Who sits where and when — the arrangement the promise is about. */
  readonly assignments: readonly AvailabilityAssignment[];
}

/* ── Legacy ↔ ECS converters ─────────────────────────────────────────── */

function must<T, E>(result: Result<T, E>): T {
  if (result.isFailure()) defect('unreachable: an id the match was built from');
  return result.value;
}

/** A brand built from a legacy value its own class already validated. */
function sure<T>(
  result: { readonly ok: true; readonly value: T } | { readonly ok: false },
  what: string,
): T {
  if (!result.ok) defect(`unreachable: ${what}`);
  return result.value;
}

function toTerms(terms: ServiceTerms): TermsData {
  return TermsData.of(
    sure(PriceCents.of(terms.price.toMinorUnits()), 'a catalogue price'),
    sure(Currency.parse(terms.price.currencyCode()), 'a catalogue currency'),
    sure(DurationMinutes.of(terms.durationMinutes), 'a catalogue duration'),
    sure(MinuteCount.of(terms.setupMinutes), 'a setup pad'),
    sure(MinuteCount.of(terms.cleanupMinutes), 'a cleanup pad'),
  );
}

function toService(service: Service): CartService {
  return {
    id: ServiceKey.of(service.id.value),
    ...toTerms(service.baseTerms),
    // Every declared variant's terms per barber: the only variants a line
    // can name (`Service.create` refuses an override of any other).
    offerings: service.offerings.map((offering) => ({
      barberId: BarberKey.of(offering.barberId.value),
      ...toTerms(offering.base),
      overrides: service.variants.map((variant) => ({
        variantId: VariantKey.of(variant.id.value),
        ...toTerms(offering.termsFor(variant.id)),
      })),
    })),
    locationIds: service.locationIds.map((id) => LocationKey.of(id.value)),
  };
}

function toCart(cart: WaitlistRequest['cart']): CartData {
  return {
    cartSeats: cart.seats.map((seat) => {
      const seatKey = SeatKeyText.of(seat.seatKey);
      return {
        seatKey,
        lines: seat.lines.map((line) => ({
          lineId: LineKey.of(line.id),
          seatKey,
          serviceId: ServiceKey.of(line.serviceId),
          variantId:
            line.variantId === null ? null : VariantKey.of(line.variantId),
          barberId: line.barberId === null ? null : BarberKey.of(line.barberId),
          locationId: null,
        })),
      };
    }),
    cartNextSequence: cart.nextSequence,
  };
}

function toWhen(when: FlexibleWhen): WhenData {
  return WhenData.of(
    when.days.map((day) =>
      DayWindowsData.of(
        sure(LocalDate.parse(day.dayKey), 'a stored request day'),
        // A LocalTimeRange is a valid span of one day by construction.
        day.windows.map((window) =>
          MinuteRange.of(
            sure(
              MinuteOfDay.of(window.start.minutesFromMidnight()),
              'a window start',
            ),
            sure(
              EndMinute.of(window.end.minutesFromMidnight()),
              'a window end',
            ),
          ),
        ),
      ),
    ),
  );
}

function toPolicy(policy: BookingPolicy): PolicyData {
  return {
    maxPartySize: policy.maxPartySize,
    slotStepMinutes: sure(
      DurationMinutes.of(policy.slotStepMinutes),
      'the policy slot step',
    ),
    minLeadMinutes: sure(
      MinuteCount.of(policy.minLeadMinutes),
      'the policy lead time',
    ),
    horizonMonths: policy.horizonMonths,
    cancellationWindowHours: policy.cancellationWindowHours,
    maxFlexibleDays: policy.maxFlexibleDays,
    autoConfirm: policy.autoConfirm,
  };
}

/**
 * A legacy instant → its minute on `localDate`'s wall clock, held to the
 * day: an instant before the day reads `0`, one after it (the next
 * midnight included) `1440`.
 */
function minuteOn(
  epochMs: number,
  localDate: LocalDate,
  zone: TimeZone,
): number {
  const wall = ZonedTimeSystem.toLocal(
    sure(UtcEpochMs.of(epochMs), 'a stored instant'),
    zone,
  );
  if (wall.localDate < localDate) return 0;
  if (wall.localDate > localDate) return 1440;
  return wall.minute;
}

/**
 * A minute of `localDate`'s wall clock → its instant: `1440` is the next
 * day's start; a minute a spring-forward erased resolves FORWARD to the
 * first minute that exists (the transition instant), as the legacy day
 * table did.
 */
function instantOn(
  minutes: number,
  localDate: LocalDate,
  zone: TimeZone,
): number {
  for (let minute = minutes; minute < 1440; minute++) {
    const at = ZonedTimeSystem.toUtc(
      localDate,
      sure(MinuteOfDay.of(minute), 'a minute of the day'),
      zone,
    );
    if (at.ok) return at.value;
  }
  return ZonedTimeSystem.startOfLocalDay(LocalDate.addDays(localDate, 1), zone);
}

function toBarberDay(
  barber: BarberDayAvailability,
  localDate: LocalDate,
  zone: TimeZone,
): CartBarberDay {
  const barberId = BarberKey.of(barber.barberId.value);
  const windows: RosterWindow[] = [];
  for (const window of barber.windows) {
    const start = MinuteOfDay.of(
      minuteOn(window.interval.startMs, localDate, zone),
    );
    const end = EndMinute.of(minuteOn(window.interval.endMs, localDate, zone));
    if (!start.ok || !end.ok || start.value >= end.value) continue;
    windows.push(
      RosterWindow.of(
        barberId,
        LocationKey.of(window.locationId.value),
        start.value,
        end.value,
      ),
    );
  }
  const busy: MinuteRange[] = [];
  for (const span of barber.busy) {
    const start = minuteOn(span.startMs, localDate, zone);
    const end = minuteOn(span.endMs, localDate, zone);
    // Clamped to [0, 1440] on the shop day, so a non-empty span is a valid range.
    if (start < end) {
      busy.push(
        MinuteRange.of(
          sure(MinuteOfDay.of(start), 'a busy start'),
          sure(EndMinute.of(end), 'a busy end'),
        ),
      );
    }
  }
  return { barberId, windows, busy };
}

/** The day and the snapshot's catalogue and roster, as the system reads them. */
type ConvertedDay = {
  readonly localDate: LocalDate;
  readonly zone: TimeZone;
  readonly services: readonly CartService[];
  readonly barbers: readonly CartBarberDay[];
};

/*
 * Private converter caches, keyed by the objects the caller shares across a
 * day's requests (the snapshot, the clock reading, the policy): a legacy
 * value is converted once, never once per request. Weak, so a finished
 * trigger's values are collected with it.
 */
const CONVERTED_DAYS = new WeakMap<
  MatchWaitlistSnapshot,
  Map<string, ConvertedDay | null>
>();
const SHOP_NOWS = new WeakMap<ZonedDateTime, Map<TimeZone, ShopNow>>();
const POLICIES = new WeakMap<BookingPolicy, PolicyData>();

function convertedDayOf(
  snapshot: MatchWaitlistSnapshot,
  day: CalendarDay,
): ConvertedDay | null {
  let byDay = CONVERTED_DAYS.get(snapshot);
  if (byDay === undefined) {
    byDay = new Map();
    CONVERTED_DAYS.set(snapshot, byDay);
  }
  const key = day.key();
  const cached = byDay.get(key);
  if (cached !== undefined) return cached;
  const localDate = LocalDate.parse(key);
  const zone = ZonedTimeSystem.checkZone(snapshot.zone);
  const converted =
    !localDate.ok || !zone.ok
      ? null
      : {
          localDate: localDate.value,
          zone: zone.value,
          services: snapshot.services.map(toService),
          barbers: snapshot.barbers.map((barber) =>
            toBarberDay(barber, localDate.value, zone.value),
          ),
        };
  byDay.set(key, converted);
  return converted;
}

/** The shop's "now" for a clock reading, derived once per zone. */
function shopNowOf(now: ZonedDateTime, zone: TimeZone): ShopNow {
  let byZone = SHOP_NOWS.get(now);
  if (byZone === undefined) {
    byZone = new Map();
    SHOP_NOWS.set(now, byZone);
  }
  let shopNow = byZone.get(zone);
  if (shopNow === undefined) {
    shopNow = ZonedTimeSystem.shopNow(
      sure(UtcEpochMs.of(now.toMillis()), 'the clock reading'),
      zone,
    );
    byZone.set(zone, shopNow);
  }
  return shopNow;
}

function policyDataOf(policy: BookingPolicy): PolicyData {
  let data = POLICIES.get(policy);
  if (data === undefined) {
    data = toPolicy(policy);
    POLICIES.set(policy, data);
  }
  return data;
}

/**
 * Does anything on this day now fit what this request asked for? A
 * notification is a PROMISE, so this is `WaitlistSystem.match`: the grid's
 * own question with the request's declared windows as the mask, at the shop
 * it named (or every listed shop, one party one shop), after the lead time,
 * inside the horizon, for a bag the commit still admits. `null` — nothing
 * fits — is the overwhelmingly common answer.
 */
export function matchWaitlist(
  request: WaitlistRequest,
  day: CalendarDay,
  snapshot: MatchWaitlistSnapshot,
  deps: { readonly now: ZonedDateTime; readonly policy: BookingPolicy },
): WaitlistMatch | null {
  // A bag the cart cannot read is no promise (the legacy reader's refusal).
  const cart = BookingCart.reconstitute(request.cart);
  if (cart.isFailure()) return null;
  // The day and the converted catalogue and roster, once per shared
  // snapshot: the caller hands every request watching the day the SAME
  // snapshot, so N requests are one conversion.
  const converted = convertedDayOf(snapshot, day);
  if (converted === null) return null;
  const { localDate, zone } = converted;
  const cartData = toCart(request.cart);

  const found = WaitlistSystem.match(
    {
      id: WaitlistRequestId.of(request.id.value),
      locationId:
        request.locationId === null
          ? null
          : LocationKey.of(request.locationId.value),
      cartSeats: cartData.cartSeats,
      cartNextSequence: cartData.cartNextSequence,
      flexibleDays: toWhen(request.when).flexibleDays,
    },
    localDate,
    { services: converted.services, barbers: converted.barbers },
    {
      now: shopNowOf(deps.now, zone),
      policy: policyDataOf(deps.policy),
      admissible: cartAdmissible(
        cart.value,
        snapshot.services,
        deps.policy,
        request.locationId,
      ).isSuccess(),
    },
  );
  if (found === null) return null;

  return {
    request,
    day,
    locationId: must(LocationId.create(found.locationId)),
    startMs: instantOn(found.startMinutes, localDate, zone),
    endMs: instantOn(found.endMinutes, localDate, zone),
    barberIds: found.barberIds.map((id) => must(BarberId.create(id))),
    assignments: found.assignments.map((assignment) => ({
      lineId: assignment.lineId,
      barberId: must(BarberId.create(assignment.barberId)),
      slot: Interval.of(
        instantOn(assignment.startMinutes, localDate, zone),
        instantOn(assignment.endMinutes, localDate, zone),
      ),
    })),
  };
}
