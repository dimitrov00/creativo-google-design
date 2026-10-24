/**
 * The dev catalogue's PLAN LOGIC — a barber's bookable window on a day, the
 * published exceptions the calendar places, a chair's reset and the terms
 * a chair sells a seat at — over the catalogue's own documents.
 *
 * The documents themselves are TypeScript (flip 1): `fixtures/catalog.fixtures.ts`
 * (category, shops, barbers, services) and `fixtures/schedules.fixtures.ts`
 * (the rosters, the published exceptions and the fabricated busy days),
 * every body `satisfies` its entity. This module reads those same bodies —
 * `openingHours`, `versions[].segments`, `offerings[].overrides` — so the
 * history generator prices a seat and finds a barber's hours from
 * exactly what the seed writes, and a test reads the same numbers. Nothing
 * here touches Firebase.
 *
 * Loaded by the specs (vitest resolves the `.ts` imports) and, at run time,
 * inside the seed's bundle (`load-domain.mjs`), never by plain Node.
 */
import { OpeningState } from '@core/components';
import { ExceptionEffect } from '@core/primitives';
import {
  BARBERS,
  CATEGORY,
  HAIRCUTS,
  LOCATIONS,
  SERVICES,
} from './fixtures/catalog.fixtures.ts';
import {
  busyDayBody,
  busyKeyOf,
  closedDayBody,
  SCHEDULES,
} from './fixtures/schedules.fixtures.ts';

export {
  BARBERS,
  CATEGORY,
  HAIRCUTS,
  LOCATIONS,
  SCHEDULES,
  SERVICES,
  busyDayBody,
  busyKeyOf,
  closedDayBody,
};

/** A roster's segments for a `Weekday` (1 = Monday … 7 = Sunday), in week order. */
function rosteredOn(barberId, weekday) {
  const schedule = SCHEDULES.find((entry) => entry.id === barberId);
  // One open-ended version per roster: the seed's history is placed by the
  // pattern, as the roster has read since the shop opened.
  const [version] = schedule?.body.versions ?? [];
  return (version?.segments ?? []).filter(
    (segment) => segment.weekday === weekday,
  );
}

/**
 * A barber's BOOKABLE segments on a `Weekday` (1 = Monday … 7 = Sunday, as
 * `calendar.weekdayAt` answers), as minutes of the day: the roster's
 * segments clamped to their shop's `openingHours` that day, the outer
 * envelope the booking flow clamps every window to. Stefan's Saturday
 * 09:00 start meets a Center that opens at 10:00, so his Saturday is sold
 * from 10:00, and so is it seeded.
 */
export function segmentsOn(barberId, weekday) {
  return rosteredOn(barberId, weekday).flatMap(
    ({ startMinutes, endMinutes, locationId }) => {
      const location = LOCATIONS.find((entry) => entry.id === locationId);
      // `openingHours` is Monday-first: index `weekday - 1`.
      const hours = location?.body.openingHours[weekday - 1];
      if (!hours || hours.openingState !== OpeningState.Open) return [];
      const startMinute = Math.max(startMinutes, hours.openMinutes);
      const endMinute = Math.min(endMinutes, hours.closeMinutes);
      return endMinute > startMinute
        ? [{ startMinute, endMinute, locationId }]
        : [];
    },
  );
}

/**
 * The earliest a published exception is placed: past the day fixtures'
 * days (at most four, `buildClientBook`'s `appointmentDays`), so no fixture
 * has to move around it.
 */
export const EXCEPTION_EARLIEST_OFFSET = 5;

/**
 * The first day from `from` on that `barberId`'s roster works, as a day
 * offset on `calendar`, and the shop the roster puts them in that day.
 * Every barber works some day of any week, so a week always finds one.
 */
function firstWorkedDay(barberId, calendar, from) {
  for (let offset = from; offset < from + 7; offset++) {
    const [segment] = segmentsOn(barberId, calendar.weekdayAt(offset));
    if (segment) return { dayOffset: offset, locationId: segment.locationId };
  }
  throw new Error(`seed: ${barberId} works no day of the week from ${from}`);
}

/** One answer per calendar: `segmentsAt` asks for every day of the history. */
const exceptionsByCalendar = new WeakMap();

/**
 * The published schedule exceptions on the shop's `calendar`, by day offset
 * from its today. One for now: Stefan is off on the first day from
 * {@link EXCEPTION_EARLIEST_OFFSET} on that his ROSTER works, so the
 * calendar visibly greys a day the roster says is worked — if it stops
 * greying, the exception pipeline broke. A fixed offset could not promise
 * that: on a Tuesday +5 is a Sunday and on a Friday a Wednesday, both his
 * days off anyway, where the greyed day told nothing apart from the roster.
 *
 * The seed writes these (`closedDayBody`); `segmentsAt` (and so every
 * placement) and the specs read the same answer.
 */
export function scheduleExceptionsFor(calendar) {
  let exceptions = exceptionsByCalendar.get(calendar);
  if (!exceptions) {
    exceptions = Object.freeze([
      Object.freeze({
        barberId: 'stefan',
        ...firstWorkedDay('stefan', calendar, EXCEPTION_EARLIEST_OFFSET),
        // A whole day off.
        exceptionEffect: ExceptionEffect.Closed,
      }),
    ]);
    exceptionsByCalendar.set(calendar, exceptions);
  }
  return exceptions;
}

/**
 * A barber's bookable segments on one day of the shop's `calendar` — the
 * weekly roster, unless an exception closes that day.
 */
export function segmentsAt(barberId, calendar, dayOffset) {
  const closed = scheduleExceptionsFor(calendar).some(
    (exception) =>
      exception.barberId === barberId &&
      exception.dayOffset === dayOffset &&
      exception.exceptionEffect === ExceptionEffect.Closed,
  );
  return closed ? [] : segmentsOn(barberId, calendar.weekdayAt(dayOffset));
}

/**
 * A barber's reset between UNRELATED clients — the padding the booking
 * puts around every busy interval of that chair before it will place a
 * seat. Never applied between two seats of one party.
 */
export function turnaroundMinutesOf(barberId) {
  const schedule = SCHEDULES.find((entry) => entry.id === barberId);
  if (!schedule) throw new Error(`seed: no roster for ${barberId}`);
  return schedule.body.turnaroundMinutes;
}

/**
 * The chair's own terms for a service and variant — the price a seat is
 * SOLD at, read off the service document's `offerings`: the barber's
 * override for the variant, else that barber's base. A seat used to be
 * seeded at a flat 28,00 € whatever the service, so every seeded visit
 * read as custom-priced («по договорка») on the staff sheet (owner,
 * 2026-09-10).
 *
 * Refuses a barber the service has no offering for, for EVERY fixture. The
 * hand-authored day fixtures used to fall back to the first offering, so
 * `appt-dev-3` sat Нико on a beard he does not sell, priced at Стефан's
 * terms, on the staff screens and in Петър's stats (2026-09-25). A seat the
 * booking flow could not have sold now stops the seed before its first write.
 *
 * Answers `{ priceCents, currency, durationMinutes }`.
 */
export function chairTerms(serviceId, barberId, variantId) {
  const service = SERVICES.find((entry) => entry.id === serviceId)?.body;
  if (!service) throw new Error(`seed: no service ${serviceId}`);
  // NO ILLEGAL SEATS (owner, 2026-09-10): a service with variants is only
  // ever sold per variant — the callable refuses a bare seat on it, and the
  // seeder, which writes past the callable, must refuse it too.
  if (service.variants.length > 0 && !variantId) {
    throw new Error(
      `seed: ${serviceId} has variants — the seat must choose one`,
    );
  }
  if (
    variantId &&
    !service.variants.some((variant) => variant.variantId === variantId)
  ) {
    throw new Error(`seed: ${serviceId} has no variant ${variantId}`);
  }
  const offering = service.offerings.find(
    (entry) => entry.barberId === barberId,
  );
  if (!offering) {
    throw new Error(`seed: ${barberId} does not offer ${serviceId}`);
  }
  const terms =
    (variantId &&
      offering.overrides.find(
        (override) => override.variantId === variantId,
      )) ||
    offering;
  return {
    priceCents: terms.priceCents,
    currency: terms.currency,
    durationMinutes: terms.durationMinutes,
  };
}
