/**
 * THE DEV SEED'S WAITLIST REQUEST (flip 1): `waitlistRequests/{id}` as the
 * flat `WaitlistRequest` minus its `id` — the owner's ACCOUNT (the request
 * tells them, through their inbox), the shop, the days it watches as the
 * `localDates` query mirror beside the declaration itself
 * (`flexibleDays`), the cart in the one cart serialisation, and the
 * lifecycle at the root. `utcEpochMs` is the first instant of the first
 * watched day on the clock of the shop it names (the default shop's for a
 * request of any shop), computed once at ingestion (F-28); no zone is
 * stored (Law 7.2). The TTL `purgeAt` is the writer's
 * (`purgeAtFor`), never part of the body.
 */
import {
  BookingCart,
  DayWindows,
  MinuteRange,
  SeatKey,
  WaitlistLifecycle,
} from '@core/components';
import type { WaitlistRequest } from '@core/entities';
import {
  BarberId,
  LocalDate,
  LocationId,
  ServiceId,
  ServiceVariantId,
  UserId,
  UtcEpochMs,
} from '@core/primitives';
import { ZonedTimeSystem } from '@core/systems';
import {
  type Body,
  day,
  endAt,
  present,
  SHOP_TIME_ZONE,
  startAt,
  sure,
  timeZoneOf,
} from './catalog.fixtures';

/** One service the request's own seat asks for — with whoever is free when `barberId` is `null`. */
export type WaitlistLinePlan = {
  readonly serviceId: string;
  readonly variantId: string | null;
  readonly barberId: string | null;
};

/** A watched day and its windows, `[startMinutes, endMinutes)` on the shop's clock. */
export type WaitlistDayPlan = {
  readonly localDate: string;
  readonly windows: readonly (readonly [number, number])[];
};

export type WaitlistPlan = {
  readonly ownerUserId: string;
  readonly locationId: string | null;
  readonly days: readonly WaitlistDayPlan[];
  readonly lines: readonly WaitlistLinePlan[];
  readonly createdAtUtcMs: number;
};

/** `waitlistRequests/{id}` from its plan: an OPEN request, opened when it was made. */
export function waitlistRequestBody(plan: WaitlistPlan): Body<WaitlistRequest> {
  const self = SeatKey.text(SeatKey.self());
  let cart = BookingCart.empty();
  for (const line of plan.lines) {
    cart = sure(
      BookingCart.addLine(cart, self, {
        serviceId: ServiceId.of(line.serviceId),
        variantId:
          line.variantId === null ? null : ServiceVariantId.of(line.variantId),
        barberId: line.barberId === null ? null : BarberId.of(line.barberId),
        locationId: null,
      }),
      `waitlist line ${line.serviceId}`,
    );
  }
  const flexibleDays = plan.days.map((watched) =>
    DayWindows.of(
      day(watched.localDate),
      watched.windows.map(([from, to]) =>
        MinuteRange.of(startAt(from), endAt(to)),
      ),
    ),
  );
  const localDates = flexibleDays
    .map((watched) => watched.localDate)
    .sort(LocalDate.compare);
  const first = present(localDates[0] ?? null, 'a request watching no day');
  const createdAtUtcMs = sure(UtcEpochMs.of(plan.createdAtUtcMs), 'created');
  return {
    ownerUserId: UserId.of(plan.ownerUserId),
    locationId:
      plan.locationId === null ? null : LocationId.of(plan.locationId),
    localDates,
    utcEpochMs: ZonedTimeSystem.startOfLocalDay(
      first,
      plan.locationId === null ? SHOP_TIME_ZONE : timeZoneOf(plan.locationId),
    ),
    createdAtUtcMs,
    ...cart,
    flexibleDays,
    ...WaitlistLifecycle.open(createdAtUtcMs),
  } satisfies Omit<WaitlistRequest, 'id'>;
}
