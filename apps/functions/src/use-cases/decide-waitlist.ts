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
  CartLineId as LineKey,
  LocalDate,
  SchedulingErrorCode,
  SeatKeyText,
  ServiceId as ServiceKey,
  ServiceVariantId as VariantKey,
  UserId as UserKey,
  UtcEpochMs,
  type WaitlistError,
  WaitlistErrorCode,
  defect,
} from '@core/primitives';
import {
  type BookingCart as CartData,
  DayHours,
  type FlexibleWhen as WhenData,
} from '@core/components';
import {
  type WaitlistAskInput,
  WaitlistSystem,
  ZonedTimeSystem,
} from '@core/systems';
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

function toAsk(request: DecideWaitlistRequest): WaitlistAskInput {
  return {
    locationId: request.locationId,
    days: request.days.map((day) => ({
      localDate: day.dayKey,
      windows: day.windows.map((window) => ({
        startMinutes: minutesOf(window.from),
        endMinutes: minutesOf(window.to),
      })),
    })),
    cart: toCartData(request.cart),
  };
}

function toWhenProps(when: WhenData): WaitlistRequestProps['when'] {
  return {
    days: when.flexibleDays.map((day) => ({
      dayKey: day.localDate,
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
): { readonly errorCode: string } | null {
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
  // The legacy commit code rides through as the refusal's `field`, byte for
  // byte what the wire carried before.
  return admitted.isFailure() ? { errorCode: admitted.error.code } : null;
}

/**
 * A refusal's `field` as the wire has always spelt it: the payload field
 * (`dayKey` — the wire's name for the ask's `localDate`) or the legacy
 * dotted code of the scheduling refusal underneath. Anything else (a
 * payload field, the commit's legacy code) passes as it is.
 */
const LEGACY_FIELD: { readonly [field: string]: string } = {
  localDate: 'dayKey',
  [SchedulingErrorCode.WaitlistNoDays]: 'scheduling.waitlist.no_days',
  [SchedulingErrorCode.WaitlistEmptyCart]: 'scheduling.waitlist.empty_cart',
};

function toLegacyError(error: WaitlistError): RequestWaitlistError {
  switch (error.errorCode) {
    case WaitlistErrorCode.Unauthenticated:
      return new RequestWaitlistUnauthenticatedError();
    case WaitlistErrorCode.InvalidRequest:
      return new RequestWaitlistInvalidError(
        LEGACY_FIELD[error.field] ?? error.field,
      );
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
  // The shop's "now", derived once at this boundary from the legacy zone.
  const zone = ZonedTimeSystem.checkZone(deps.zone);
  const nowUtcMs = UtcEpochMs.of(deps.now.toMillis());
  const horizonEnd = LocalDate.parse(deps.horizonEnd.key());
  if (!zone.ok || !nowUtcMs.ok || !horizonEnd.ok) {
    defect('unreachable: the tenant zone, the clock and the horizon');
  }
  const decided = WaitlistSystem.decide(toAsk(request), {
    ownerUserId:
      deps.ownerUserId === null ? null : UserKey.of(deps.ownerUserId),
    now: ZonedTimeSystem.shopNow(nowUtcMs.value, zone.value),
    horizonEndLocalDate: horizonEnd.value,
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
    when: toWhenProps(decided.value),
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
