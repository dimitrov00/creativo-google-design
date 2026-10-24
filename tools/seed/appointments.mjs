/**
 * Seed visit INTENTS → `appointments/{id}` documents (flip 1: the flat
 * `Appointment` body of `fixtures/appointments.fixtures.ts`).
 *
 * An intent is authored in the entity's own vocabulary on a day offset and
 * at minutes of that day (`VisitIntent`: the seats' stored fields, their
 * occupant slices, an `attendanceState` per seat). This module places it
 * on one shop calendar and the catalogue — the shop day, each seat's sold
 * terms, the instant each outcome was stamped, the booking and arrival
 * instants — and refuses what the book could never hold. Every instant is
 * derived from the slot, never from `Date.now()`, so a second run on the
 * same day writes the same bytes and the stats trigger sees nothing to
 * recompute.
 *
 * The body is typed (`satisfies Omit<Appointment, 'id'>` in the builder),
 * so a field the archetype gains and the seed lacks fails
 * `pnpm nx typecheck seed-tools`, and `seed-data.spec.mjs` holds every
 * document to the mirrors `AppointmentIndexSystem` derives.
 */
import { AttendanceState, UtcEpochMs } from '@core/primitives';
import { chairTerms } from './catalog.mjs';
import {
  appointmentBody,
  appointmentPhotoBody,
  SCHEDULED_SEAT,
} from './fixtures/appointments.fixtures.ts';

export { appointmentPhotoBody };

/** A no-show is stamped a quarter of an hour in, when the shop gives up waiting. */
const NO_SHOW_AFTER_MINUTES = 15;

/**
 * A seat's sold terms: the chair's catalogue price, and the seat's own
 * minutes, else the catalogue's — with the catalogue's minutes beside them
 * (`catalogMinutes`), which a re-timed seat records. A seat its barber does
 * not sell has no price at all — the refusal names the seat, so the fixture
 * is one search away rather than one of a few hundred.
 */
export function soldTerms(seat) {
  let sold;
  try {
    sold = chairTerms(seat.serviceId, seat.barberId, seat.variantId);
  } catch (cause) {
    throw new Error(
      `seed: seat ${seat.seatId} cannot be sold (${cause.message})`,
      { cause },
    );
  }
  return {
    priceCents: sold.priceCents,
    minutes: seat.durationMinutes ?? sold.durationMinutes,
    catalogMinutes: sold.durationMinutes,
  };
}

function seatWindowMs(calendar, dayOffset, seat) {
  const { minutes } = soldTerms(seat);
  return {
    startMs: calendar.msAt(dayOffset, seat.startMinutes),
    endMs: calendar.msAt(dayOffset, seat.startMinutes + minutes),
  };
}

/** A seat already worked or given up on — the story of a visit that has happened. */
const isSettled = (seat) =>
  seat.attendanceState === AttendanceState.Worked ||
  seat.attendanceState === AttendanceState.NoShow;

/**
 * A settled visit on TODAY is settled only once its time has passed (owner,
 * 2026-09-09: a 10:00 cut read «Минал» at 09:55). Before that it is an
 * ordinary confirmed booking, so the sheet shows the live states — «след 5
 * мин», «В момента», «Дошъл» — on real data. A past day is always past, so
 * its history settles as authored; a future day never does.
 *
 * Cancellations are left alone: a visit can be called off before its slot,
 * and `appointmentDocumentOf` refuses one stamped after `now`.
 */
export function settledOnlyIfPast(visit, calendar) {
  if (!visit.seats.some(isSettled)) return visit;
  const ends = visit.seats.map(
    (seat) => seatWindowMs(calendar, visit.dayOffset, seat).endMs,
  );
  if (calendar.nowMs >= Math.max(...ends)) return visit;
  const arrived =
    visit.arrivedMinutes !== null &&
    calendar.msAt(visit.dayOffset, visit.arrivedMinutes) <= calendar.nowMs;
  return {
    ...visit,
    // An arrival the clock has not reached yet has not happened either.
    arrivedMinutes: arrived ? visit.arrivedMinutes : null,
    seats: visit.seats.map((seat) => ({
      ...seat,
      ...SCHEDULED_SEAT,
      tipCents: null,
    })),
  };
}

/**
 * The instant a seat's outcome was stamped: as the chair frees up for a
 * worked seat, a quarter of an hour in for a no-show, and for a
 * cancellation at the moment the intent names, else so many hours before
 * the slot — or `null` while it is scheduled.
 */
function resolvedAtOf(seat, window, calendar) {
  switch (seat.attendanceState) {
    case AttendanceState.Scheduled:
      return null;
    case AttendanceState.Worked:
      return window.endMs;
    case AttendanceState.NoShow:
      return UtcEpochMs.plusMinutes(window.startMs, NO_SHOW_AFTER_MINUTES);
    case AttendanceState.Cancelled:
      return seat.cancelledOn === null
        ? UtcEpochMs.plusHours(window.startMs, -seat.cancelledHoursBefore)
        : calendar.msAt(seat.cancelledOn.dayOffset, seat.cancelledOn.minutes);
    default:
      throw new Error(
        `seed: seat ${seat.seatId} has no attendance state the seed stamps (${seat.attendanceState})`,
      );
  }
}

/** An instant of the calendar, or `null` for no moment. */
const msOf = (calendar, moment) =>
  moment === null ? null : calendar.msAt(moment.dayOffset, moment.minutes);

/**
 * One visit intent → `{ id, doc }`, `doc` the flat body.
 *
 * Refuses what the book could never hold: a visit placed in no shop, a fact
 * stamped after `now` (a no-show that has not happened), a cancellation
 * after the visit began, a booking made after its own slot, a tip on a seat
 * that was not worked. The seed writes past the callables, so it has to
 * keep their promises itself.
 */
export function appointmentDocumentOf(visit, calendar) {
  if (visit.locationId === null) {
    throw new Error(`seed: ${visit.id} was never placed in a shop`);
  }
  const seats = visit.seats.map((seat) => {
    const { priceCents, minutes, catalogMinutes } = soldTerms(seat);
    const window = seatWindowMs(calendar, visit.dayOffset, seat);
    const resolvedAtUtcMs = resolvedAtOf(seat, window, calendar);
    if (resolvedAtUtcMs !== null && resolvedAtUtcMs > calendar.nowMs) {
      throw new Error(
        `seed: ${visit.id}/${seat.seatId} is ${seat.attendanceState} after now`,
      );
    }
    if (
      seat.attendanceState === AttendanceState.Cancelled &&
      resolvedAtUtcMs >= window.startMs
    ) {
      throw new Error(
        `seed: ${visit.id}/${seat.seatId} is cancelled after it started`,
      );
    }
    if (
      seat.tipCents !== null &&
      seat.attendanceState !== AttendanceState.Worked
    ) {
      throw new Error(`seed: ${visit.id}/${seat.seatId} tips an unworked seat`);
    }
    return {
      window,
      plan: {
        seat,
        priceCents,
        // The seat's own minutes when it names them: a visit booked
        // shorter or longer than the catalogue is what the frame's tag
        // exists to show. The catalogue's minutes ride beside a re-timing
        // exactly as a staff override keeps them, so the visit sheet marks
        // the seat custom; terms the catalogue sells as they are record
        // nothing.
        durationMinutes: minutes,
        catalogDurationMinutes: catalogMinutes,
        resolvedAtUtcMs,
      },
    };
  });

  const firstStartMs = Math.min(...seats.map(({ window }) => window.startMs));
  const bookedAtUtcMs = msOf(calendar, visit.bookedOn);
  if (
    bookedAtUtcMs !== null &&
    (bookedAtUtcMs >= firstStartMs || bookedAtUtcMs > calendar.nowMs)
  ) {
    throw new Error(`seed: ${visit.id} is booked after it starts`);
  }

  return {
    id: visit.id,
    doc: appointmentBody({
      visit,
      locationId: visit.locationId,
      localDate: calendar.dayKeyAt(visit.dayOffset),
      bookedAtUtcMs,
      arrivedAtUtcMs:
        visit.arrivedMinutes === null
          ? null
          : calendar.msAt(visit.dayOffset, visit.arrivedMinutes),
      seats: seats.map(({ plan }) => plan),
    }),
  };
}
