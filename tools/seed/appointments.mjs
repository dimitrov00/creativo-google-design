/**
 * Seed appointment FIXTURES → `appointments/{id}` documents (flip 1: the
 * flat `Appointment` body of `fixtures/appointments.fixtures.ts`).
 *
 * A fixture names wall-clock times on a day offset and SYMBOLIC outcomes
 * («worked», «cancelled 3 h before»); this module resolves them against one
 * shop calendar into the builder's plan — the shop day, minutes past
 * midnight, epoch-ms instants and the entity's own tags — and refuses what
 * the book could never hold. Every instant is derived from the slot, never
 * from `Date.now()`, so a second run on the same day writes the same bytes
 * and the stats trigger sees nothing to recompute.
 *
 * The body is typed (`satisfies Omit<Appointment, 'id'>` in the builder),
 * so a field the archetype gains and the seed lacks fails
 * `pnpm nx typecheck seed-tools`, and `seed-data.spec.mjs` holds every
 * document to the mirrors `AppointmentIndexSystem` derives.
 */
import { chairTerms } from './catalog.mjs';
import {
  appointmentBody,
  appointmentPhotoBody,
} from './fixtures/appointments.fixtures.ts';

export { appointmentPhotoBody };

export const SCHEDULED = { kind: 'scheduled' };

/**
 * The free-cancellation window the seeded `settings/bookingPolicy` sets, and
 * so the window every seeded cancellation was made under: stamped on its
 * seats as the cancel paths stamp it (2026-09-25), which keeps the seed's
 * late cancels where they are whatever the window is moved to later.
 */
export const CANCELLATION_WINDOW_HOURS = 24;

/** An account seat. `self` is the booker; `companion` rides on their booking. */
export const account = (userId, relationship = 'self') => ({
  kind: 'account',
  userId,
  relationship,
});

/** An anonymous seat: no account, no PII beyond the handle staff typed. */
export const guest = (label) => ({ kind: 'anonymous', label });

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;

/**
 * A seat's sold terms: the chair's catalogue price, and the fixture's own
 * minutes, else the catalogue's — with the catalogue's minutes beside them
 * (`catalogMinutes`), which a re-timed seat records. A seat its barber does
 * not sell has no price at all — the refusal names the seat, so the fixture
 * is one search away rather than one of a few hundred.
 */
export function soldTerms(seat) {
  let sold;
  try {
    sold = chairTerms(seat.serviceId, seat.barberId, seat.variantId ?? null);
  } catch (cause) {
    throw new Error(`seed: seat ${seat.id} cannot be sold (${cause.message})`, {
      cause,
    });
  }
  return {
    priceCents: sold.priceCents,
    minutes: seat.minutes ?? sold.durationMinutes,
    catalogMinutes: sold.durationMinutes,
  };
}

function seatWindowMs(calendar, dayOffset, seat) {
  const { minutes } = soldTerms(seat);
  return {
    startMs: calendar.msAt(dayOffset, seat.hour, seat.minute),
    endMs: calendar.msAt(dayOffset, seat.hour, seat.minute + minutes),
  };
}

/**
 * A settled visit on TODAY is settled only once its time has passed (owner,
 * 2026-09-09: a 10:00 cut read «Минал» at 09:55). Before that it is an
 * ordinary confirmed booking, so the sheet shows the live states — «след 5
 * мин», «В момента», «Дошъл» — on real data. A past day is always past, so
 * its history settles as authored; a future day never does.
 *
 * Cancellations are left alone: a visit can be called off before its slot,
 * and the builder refuses one stamped after `now`.
 */
export function settledOnlyIfPast(appointment, calendar) {
  const kind = appointment.status.kind;
  if (kind !== 'completed' && kind !== 'no_show') return appointment;
  const ends = appointment.seats.map(
    (seat) => seatWindowMs(calendar, appointment.dayOffset, seat).endMs,
  );
  if (calendar.nowMs >= Math.max(...ends)) return appointment;
  const arrival = appointment.arrived;
  const arrived =
    arrival != null &&
    calendar.msAt(appointment.dayOffset, arrival.hour, arrival.minute) <=
      calendar.nowMs;
  return {
    ...appointment,
    status: { kind: 'confirmed' },
    // An arrival the clock has not reached yet has not happened either.
    arrived: arrived ? arrival : null,
    seats: appointment.seats.map((seat) => ({
      ...seat,
      outcome: SCHEDULED,
      tipCents: null,
    })),
  };
}

/** A symbolic `self`/`companion` → the entity's `SubjectRelationship`. */
const RELATIONSHIP = { self: 'SELF', companion: 'COMPANION', client: 'CLIENT' };
/** A symbolic preference → the entity's `BarberPreference`. */
const PREFERENCE = { any: 'ANY', specific: 'SPECIFIC' };
/** A symbolic root status → the entity's `BookingStatus`. */
const BOOKING_STATUS = {
  confirmed: 'CONFIRMED',
  completed: 'COMPLETED',
  no_show: 'NO_SHOW',
  cancelled: 'CANCELLED',
};
/** A symbolic placement → the entity's `Placement`. */
const PLACEMENT = { self: 'SELF', staff: 'STAFF' };

/** A symbolic code (`client_changed_plans`) → the entity's (`CLIENT_CHANGED_PLANS`). */
const screaming = (code) => code.toUpperCase();

function subjectPlanOf(subject) {
  return subject.kind === 'account'
    ? {
        userId: subject.userId,
        relationship: RELATIONSHIP[subject.relationship],
      }
    : { guestLabel: subject.label };
}

/**
 * Symbolic outcome → the seat's outcome plan, its instant from the slot —
 * or, for a cancellation, from `at` when the fixture names the moment
 * itself («called off last night»), which holds wherever its slot is placed.
 */
function outcomePlanOf(outcome, window, calendar) {
  switch (outcome.kind) {
    case 'scheduled':
      return { attendanceState: 'SCHEDULED' };
    case 'worked':
      // Stamped as the chair frees up.
      return { attendanceState: 'WORKED', atUtcMs: window.endMs };
    case 'no_show':
      // Stamped a quarter of an hour in, when the shop gives up waiting.
      return {
        attendanceState: 'NO_SHOW',
        atUtcMs: window.startMs + 15 * MINUTE_MS,
      };
    case 'cancelled':
      return {
        attendanceState: 'CANCELLED',
        atUtcMs: outcome.at
          ? calendar.msAt(
              outcome.at.dayOffset,
              outcome.at.hour,
              outcome.at.minute,
            )
          : window.startMs - outcome.hoursBefore * HOUR_MS,
        cancelledBy: screaming(outcome.by),
        cancellationReason: screaming(outcome.reason.kind),
        windowHours: CANCELLATION_WINDOW_HOURS,
      };
    default:
      throw new Error(`seed: unknown outcome ${outcome.kind}`);
  }
}

const atOf = (calendar, at) => calendar.msAt(at.dayOffset, at.hour, at.minute);

/**
 * One fixture → `{ id, doc }`, `doc` the flat body.
 *
 * Refuses what the book could never hold: a fact stamped after `now` (a
 * no-show that has not happened), a cancellation after the visit began, a
 * booking made after its own slot, a tip on a seat that was not worked. The
 * seed writes past the callables, so it has to keep their promises itself.
 */
export function appointmentDocumentOf(fixture, calendar) {
  const seats = fixture.seats.map((seat) => {
    const { priceCents, minutes, catalogMinutes } = soldTerms(seat);
    const window = seatWindowMs(calendar, fixture.dayOffset, seat);
    const outcome = outcomePlanOf(seat.outcome, window, calendar);
    if (outcome.attendanceState !== 'SCHEDULED' && outcome.atUtcMs > calendar.nowMs) {
      throw new Error(
        `seed: ${fixture.id}/${seat.id} is ${seat.outcome.kind} after now`,
      );
    }
    if (
      outcome.attendanceState === 'CANCELLED' &&
      outcome.atUtcMs >= window.startMs
    ) {
      throw new Error(
        `seed: ${fixture.id}/${seat.id} is cancelled after it started`,
      );
    }
    const tip = seat.tipCents ?? null;
    if (tip !== null && outcome.attendanceState !== 'WORKED') {
      throw new Error(`seed: ${fixture.id}/${seat.id} tips an unworked seat`);
    }
    return {
      window,
      plan: {
        seatId: seat.id,
        serviceId: seat.serviceId,
        variantId: seat.variantId ?? null,
        barberId: seat.barberId,
        // What the client ASKED for, beside what they got — the flag that
        // tells staff on a sick day which bookings can move chairs.
        barberPreference: PREFERENCE[seat.pref],
        startMinutes: seat.hour * 60 + seat.minute,
        priceCents,
        // The fixture's own minutes when it names them: a visit booked
        // shorter or longer than the catalogue is what the frame's tag
        // exists to show. The catalogue's minutes ride beside a re-timing
        // exactly as a staff override keeps them, so the visit sheet marks
        // the seat custom; terms the catalogue sells as they are record
        // nothing.
        durationMinutes: minutes,
        catalogDurationMinutes: catalogMinutes,
        subject: subjectPlanOf(seat.subject),
        outcome,
        tipCents: tip,
      },
    };
  });

  const firstStartMs = Math.min(...seats.map(({ window }) => window.startMs));
  const bookedMs = fixture.booked ? atOf(calendar, fixture.booked) : null;
  if (
    bookedMs !== null &&
    (bookedMs >= firstStartMs || bookedMs > calendar.nowMs)
  ) {
    throw new Error(`seed: ${fixture.id} is booked after it starts`);
  }
  const status = fixture.status;

  return {
    id: fixture.id,
    doc: appointmentBody({
      locationId: fixture.locationId ?? 'loc-center',
      localDate: calendar.dayKeyAt(fixture.dayOffset),
      placement: PLACEMENT[fixture.placement],
      bookingStatus: BOOKING_STATUS[status.kind],
      cancellationReasons:
        status.kind === 'cancelled' ? [screaming(status.reason)] : [],
      bookedAtUtcMs: bookedMs,
      arrivedAtUtcMs: fixture.arrived
        ? atOf(calendar, { dayOffset: fixture.dayOffset, ...fixture.arrived })
        : null,
      bookedFromAppointmentId: fixture.bookedFromAppointmentId ?? null,
      contact: fixture.contact ?? null,
      seats: seats.map(({ plan }) => plan),
    }),
  };
}

/**
 * The instant a seat of a stored body starts — the envelope's instant plus
 * the seat's wall-clock distance from the envelope start
 * (`TimeCoordinate.seatStartUtcMs`, T9: exact, no visit straddles a DST
 * switch, the shop is closed then).
 */
export function seatStartMsOf(doc, seat) {
  return doc.utcEpochMs + (seat.startMinutes - doc.startMinutes) * MINUTE_MS;
}
