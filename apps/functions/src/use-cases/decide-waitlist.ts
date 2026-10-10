import { Result, type ZonedDateTime, fail, ok } from '@creativo/domain/kernel';
import { LocationId, type Service } from '@creativo/domain/catalog';
import {
  BookingCart,
  type BookingPolicy,
  CalendarDay,
  WaitlistRequest,
  type WaitlistRequestProps,
} from '@creativo/domain/scheduling';
import {
  BarberId as BarberKey,
  type BookingCart as CartData,
  DayHours,
  DayKey,
  type FlexibleWhen as WhenData,
  MinuteRange,
  ServiceId as ServiceKey,
  ServiceVariantId as VariantKey,
  type WaitlistAsk,
  type WaitlistError,
  WaitlistErrorCode,
  WaitlistSystem,
} from '@creativo/ecs-core';
import {
  type AdmissibleShop,
  cartAdmissible,
  shopListed,
} from './party-admission';
import {
  RequestWaitlistDuplicateError,
  RequestWaitlistInvalidError,
  RequestWaitlistTooManyDaysError,
  type RequestWaitlistError,
  RequestWaitlistUnauthenticatedError,
} from './request-waitlist.errors';

/*
 * THIN SHIM (ECS migration Phase 2). The decision is
 * `WaitlistSystem.decide`; the commit's admission (`cartAdmissible`) and the
 * shop rule (`shopListed`) are handed to it as the door's verdicts. This file
 * keeps the legacy signature and only converts the wire shapes, the legacy
 * aggregate and the error classes.
 */

/** One declared day as it arrives on the wire. */
export interface RequestedDay {
  readonly dayKey: string;
  readonly windows: readonly { readonly from: string; readonly to: string }[];
}

export interface DecideWaitlistRequest {
  readonly locationId: string | null;
  readonly days: readonly RequestedDay[];
  readonly cart: WaitlistRequestProps['cart'];
}

export interface DecideWaitlistDeps {
  readonly now: ZonedDateTime;
  readonly zone: string;
  readonly maxFlexibleDays: number;
  readonly horizonEnd: CalendarDay;
  readonly nextId: () => string;
  readonly ownerUserId: string | null;
  /** The shop's booking policy — the party cap the commit seats by. */
  readonly policy: BookingPolicy;
  /** The ACTIVE catalogue rows of the services the cart names, read the way the commit reads them. */
  readonly services: readonly Service[];
  /** The shop the request names, read the way the commit reads it; `null` when there is no such shop. */
  readonly shop: AdmissibleShop | null;
}

/* ── Legacy ↔ ECS converters ─────────────────────────────────────────── */

/** `'HH:mm'` → minutes of the day (`DayHours.parseClock`); a face no clock shows is `NaN`, which no window accepts. */
function minutesOf(face: string): number {
  const parsed = DayHours.parseClock(face);
  return parsed.ok ? parsed.value : Number.NaN;
}

/** Minutes of the day → `'HH:mm'`. */
function faceOf(minutes: number): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}

function toCartData(cart: WaitlistRequestProps['cart']): CartData {
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

function toAsk(request: DecideWaitlistRequest): WaitlistAsk {
  return {
    locationId: request.locationId,
    days: request.days.map((day) => ({
      dayKey: day.dayKey,
      windows: day.windows.map((window) =>
        MinuteRange.of(minutesOf(window.from), minutesOf(window.to)),
      ),
    })),
    cart: toCartData(request.cart),
  };
}

function toWhenProps(when: WhenData): WaitlistRequestProps['when'] {
  return {
    days: when.days.map((day) => ({
      dayKey: day.dayKey,
      windows: day.windows.map((window) => ({
        from: faceOf(window.startMinutes),
        to: faceOf(window.endMinutes),
      })),
    })),
  };
}

/** The commit's own admission of the bag, as the door's verdict — `null` admitted. */
function admissionOf(
  request: DecideWaitlistRequest,
  deps: DecideWaitlistDeps,
): { readonly code: string } | null {
  const cart = BookingCart.reconstitute(request.cart);
  if (cart.isFailure()) return null;
  let locationId: LocationId | null = null;
  if (request.locationId !== null) {
    const parsed = LocationId.create(request.locationId);
    if (parsed.isFailure()) return null;
    locationId = parsed.value;
  }
  const admitted = cartAdmissible(
    cart.value,
    deps.services,
    deps.policy,
    locationId,
  );
  return admitted.isFailure() ? { code: admitted.error.code } : null;
}

function toLegacyError(error: WaitlistError): RequestWaitlistError {
  switch (error.code) {
    case WaitlistErrorCode.Unauthenticated:
      return new RequestWaitlistUnauthenticatedError();
    case WaitlistErrorCode.InvalidRequest:
      return new RequestWaitlistInvalidError(error.field);
    case WaitlistErrorCode.TooManyDays:
      return new RequestWaitlistTooManyDaysError(error.max);
    case WaitlistErrorCode.AlreadyWatching:
      return new RequestWaitlistDuplicateError();
  }
}

/**
 * Decide whether a waitlist request may be stored, and what storing it means
 * — `WaitlistSystem.decide`, in the commit's order: the owner from the
 * verified token, the named shop, the days (past and beyond-horizon days
 * dropped), the day cap, the windows, the bag, and the commit's own
 * admission of the party at that shop.
 */
export function decideWaitlist(
  request: DecideWaitlistRequest,
  deps: DecideWaitlistDeps,
): Result<WaitlistRequest, RequestWaitlistError> {
  const decided = WaitlistSystem.decide(toAsk(request), {
    ownerUserId: deps.ownerUserId,
    zone: deps.zone,
    nowMs: deps.now.toMillis(),
    todayDayKey: DayKey.of(CalendarDay.fromZonedDateTime(deps.now).key()),
    horizonEndDayKey: DayKey.of(deps.horizonEnd.key()),
    maxFlexibleDays: deps.maxFlexibleDays,
    shopListed: shopListed(deps.shop),
    admission: admissionOf(request, deps),
  });
  if (!decided.ok) return fail(toLegacyError(decided.error));

  // The legacy aggregate around the decided body; its id is the caller's.
  const built = WaitlistRequest.create({
    id: deps.nextId(),
    ownerId: decided.value.ownerUserId,
    locationId: decided.value.locationId,
    when: toWhenProps(decided.value.when),
    cart: request.cart,
    status: 'open',
    createdAtIso: deps.now.toISO(),
    zone: deps.zone,
  });
  if (built.isFailure()) {
    return fail(new RequestWaitlistInvalidError(built.error.code));
  }
  return ok(built.value);
}
