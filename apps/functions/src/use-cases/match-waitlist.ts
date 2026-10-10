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
  CalendarDay,
  type FlexibleWhen,
  Interval,
  type WaitlistRequest,
} from '@creativo/domain/scheduling';
import {
  BarberId as BarberKey,
  type BookingCart as CartData,
  type BookingPolicy as PolicyData,
  type CartBarberDay,
  type CartService,
  DayKey,
  DayWindows as DayWindowsData,
  FlexibleWhen as WhenData,
  LocationId as LocationKey,
  MinuteRange,
  RosterWindow,
  ServiceId as ServiceKey,
  type ServiceTerms as TermsData,
  ServiceVariantId as VariantKey,
  TimeInterval,
  WaitlistRequestId,
  WaitlistSystem,
  ZonedTimeSystem,
} from '@creativo/ecs-core';
import { cartAdmissible } from './party-admission';

/*
 * THIN SHIM (ECS migration Phase 2). The matcher is `WaitlistSystem.match`
 * (the grid's own day search, `BookingCartSystem.optionsForDay`, over the
 * request's declared windows); the commit's admission (`cartAdmissible`) is
 * handed to it as a verdict. This file keeps the legacy signature and only
 * converts the legacy classes to the ECS structs and the match back.
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
  if (result.isFailure())
    throw new Error('unreachable: an id the match was built from');
  return result.value;
}

function toTerms(terms: ServiceTerms): TermsData {
  return {
    priceMinorUnits: terms.price.toMinorUnits(),
    currencyCode: terms.price.currencyCode(),
    durationMinutes: terms.durationMinutes,
    setupMinutes: terms.setupMinutes,
    cleanupMinutes: terms.cleanupMinutes,
  };
}

function toService(service: Service): CartService {
  return {
    id: ServiceKey.of(service.id.value),
    baseTerms: toTerms(service.baseTerms),
    // Every declared variant's terms per barber: the only variants a line
    // can name (`Service.create` refuses an override of any other).
    offerings: service.offerings.map((offering) => ({
      barberId: BarberKey.of(offering.barberId.value),
      base: toTerms(offering.base),
      overrides: service.variants.map((variant) => ({
        variantId: VariantKey.of(variant.id.value),
        terms: toTerms(offering.termsFor(variant.id)),
      })),
    })),
    locationIds: service.locationIds.map((id) => LocationKey.of(id.value)),
  };
}

function toCart(cart: WaitlistRequest['cart']): CartData {
  return {
    seats: cart.seats.map((seat) => ({
      seatKey: seat.seatKey,
      lines: seat.lines.map((line) => ({
        lineId: line.id,
        seatKey: seat.seatKey,
        serviceId: ServiceKey.of(line.serviceId),
        variantId:
          line.variantId === null ? null : VariantKey.of(line.variantId),
        barberId: line.barberId === null ? null : BarberKey.of(line.barberId),
        locationId: null,
      })),
    })),
    nextSequence: cart.nextSequence,
  };
}

function toWhen(when: FlexibleWhen): WhenData {
  return WhenData.of(
    when.days.map((day) =>
      DayWindowsData.of(
        DayKey.of(day.dayKey),
        day.windows.map((window) =>
          MinuteRange.of(
            window.start.minutesFromMidnight(),
            window.end.minutesFromMidnight(),
          ),
        ),
      ),
    ),
  );
}

function toPolicy(policy: BookingPolicy): PolicyData {
  return {
    maxPartySize: policy.maxPartySize,
    slotStepMinutes: policy.slotStepMinutes,
    minLeadMinutes: policy.minLeadMinutes,
    horizonMonths: policy.horizonMonths,
    cancellationWindowHours: policy.cancellationWindowHours,
    maxFlexibleDays: policy.maxFlexibleDays,
    autoConfirm: policy.autoConfirm,
  };
}

function toBarberDay(
  barber: BarberDayAvailability,
  day: Parameters<typeof ZonedTimeSystem.minuteOfDay>[1],
): CartBarberDay {
  const barberId = BarberKey.of(barber.barberId.value);
  return {
    barberId,
    windows: barber.windows.map((window) =>
      RosterWindow.of(
        barberId,
        LocationKey.of(window.locationId.value),
        ZonedTimeSystem.minuteOfDay(window.interval.startMs, day),
        ZonedTimeSystem.minuteOfDay(window.interval.endMs, day),
      ),
    ),
    busy: barber.busy.map((span) => TimeInterval.of(span.startMs, span.endMs)),
  };
}

/** The day's row and the snapshot's catalogue and roster, as the system reads them. */
type ConvertedDay = {
  readonly row: Parameters<typeof ZonedTimeSystem.minuteOfDay>[1];
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
const TODAY_KEYS = new WeakMap<ZonedDateTime, DayKey>();
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
  const row = ZonedTimeSystem.dayTable(
    snapshot.zone,
    DayKey.of(key),
    DayKey.of(key),
  )[0];
  const converted =
    row === undefined
      ? null
      : {
          row,
          services: snapshot.services.map(toService),
          barbers: snapshot.barbers.map((barber) => toBarberDay(barber, row)),
        };
  byDay.set(key, converted);
  return converted;
}

function todayDayKeyOf(now: ZonedDateTime): DayKey {
  let key = TODAY_KEYS.get(now);
  if (key === undefined) {
    key = DayKey.of(CalendarDay.fromZonedDateTime(now).key());
    TODAY_KEYS.set(now, key);
  }
  return key;
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
  // The day's table row and the converted catalogue and roster, once per
  // shared snapshot: the caller hands every request watching the day the
  // SAME snapshot, so N requests are one Intl table and one conversion.
  const converted = convertedDayOf(snapshot, day);
  if (converted === null) return null;
  const { row } = converted;

  const found = WaitlistSystem.match(
    {
      id: WaitlistRequestId.of(request.id.value),
      locationId:
        request.locationId === null
          ? null
          : LocationKey.of(request.locationId.value),
      cart: toCart(request.cart),
      when: toWhen(request.when),
    },
    row,
    { services: converted.services, barbers: converted.barbers },
    {
      nowMs: deps.now.toMillis(),
      todayDayKey: todayDayKeyOf(deps.now),
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
    startMs: found.startMs,
    endMs: found.endMs,
    barberIds: found.barberIds.map((id) => must(BarberId.create(id))),
    assignments: found.assignments.map((assignment) => ({
      lineId: assignment.lineId,
      barberId: must(BarberId.create(assignment.barberId)),
      slot: Interval.of(assignment.slot.startMs, assignment.slot.endMs),
    })),
  };
}
