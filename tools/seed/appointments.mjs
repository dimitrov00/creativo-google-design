/**
 * Seed appointment FIXTURES → the documents `appointmentToDocument` writes.
 *
 * A fixture names wall-clock times on a day offset and SYMBOLIC outcomes
 * («worked», «cancelled 3 h before»); this module resolves them against one
 * shop calendar into the stored shape, field for field — mirrors included.
 * Every instant is derived from the slot, never from `Date.now()`, so a
 * second run on the same day writes the same bytes and the stats trigger
 * sees nothing to recompute.
 *
 * `seed-data.spec.mjs` round-trips every document through the real
 * `appointmentFromDocument` → `appointmentToDocument`, so a field the mapper
 * gains and this builder lacks fails a test instead of a trigger.
 */
import { chairTerms } from './catalog.mjs';

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

/**
 * An anonymous seat. `phone` is a walk-in's typed number, persisted on the
 * seat (R43) — written ahead of the P1 mapper, which does not read it yet.
 */
export const guest = (label, phone = null) =>
  phone === null
    ? { kind: 'anonymous', label }
    : { kind: 'anonymous', label, phone };

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
    priceMinorUnits: sold.priceMinorUnits,
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
  const arrival = appointment.arrivedAt;
  const arrived =
    arrival != null &&
    calendar.msAt(appointment.dayOffset, arrival.hour, arrival.minute) <=
      calendar.nowMs;
  return {
    ...appointment,
    status: { kind: 'confirmed' },
    // An arrival the clock has not reached yet has not happened either.
    arrivedAt: arrived ? arrival : null,
    seats: appointment.seats.map((seat) => ({
      ...seat,
      outcome: SCHEDULED,
      tipMinorUnits: null,
    })),
  };
}

/**
 * Symbolic outcome → `seatOutcomeToDocument`'s shape, its instant from the
 * slot — or, for a cancellation, from `at` when the fixture names the moment
 * itself («called off last night»), which holds wherever its slot is placed.
 */
function outcomeDocument(outcome, window, calendar) {
  switch (outcome.kind) {
    case 'scheduled':
      return SCHEDULED;
    case 'worked':
      // Stamped as the chair frees up.
      return { kind: 'worked', atMs: window.endMs };
    case 'no_show':
      // Stamped a quarter of an hour in, when the shop gives up waiting.
      return { kind: 'no_show', atMs: window.startMs + 15 * MINUTE_MS };
    case 'cancelled':
      return {
        kind: 'cancelled',
        atMs: outcome.at
          ? calendar.msAt(
              outcome.at.dayOffset,
              outcome.at.hour,
              outcome.at.minute,
            )
          : window.startMs - outcome.hoursBefore * HOUR_MS,
        by: outcome.by,
        reason: outcome.reason,
        windowHours: CANCELLATION_WINDOW_HOURS,
      };
    default:
      throw new Error(`seed: unknown outcome ${outcome.kind}`);
  }
}

function zoned(calendar, at) {
  return {
    iso: calendar.isoAt(at.dayOffset, at.hour, at.minute),
    zone: calendar.zone,
  };
}

/**
 * One fixture → `{ id, doc }`.
 *
 * Refuses what the book could never hold: a fact stamped after `now` (a
 * no-show that has not happened), a cancellation after the visit began, a
 * booking made after its own slot, a tip on a seat that was not worked. The seed writes past the callables, so it
 * has to keep their promises itself.
 */
export function appointmentDocumentOf(fixture, calendar) {
  const seats = fixture.seats.map((seat) => {
    const { priceMinorUnits, minutes, catalogMinutes } = soldTerms(seat);
    // Minutes of its own that the catalogue does not sell: staff re-timed it.
    const retimed = minutes !== catalogMinutes;
    const window = seatWindowMs(calendar, fixture.dayOffset, seat);
    const outcome = outcomeDocument(seat.outcome, window, calendar);
    if (outcome.kind !== 'scheduled' && outcome.atMs > calendar.nowMs) {
      throw new Error(
        `seed: ${fixture.id}/${seat.id} is ${outcome.kind} after now`,
      );
    }
    if (outcome.kind === 'cancelled' && outcome.atMs >= window.startMs) {
      throw new Error(
        `seed: ${fixture.id}/${seat.id} is cancelled after it started`,
      );
    }
    const tip = seat.tipMinorUnits ?? null;
    if (tip !== null && outcome.kind !== 'worked') {
      throw new Error(`seed: ${fixture.id}/${seat.id} tips an unworked seat`);
    }
    return {
      window,
      document: {
        id: seat.id,
        serviceId: seat.serviceId,
        variantId: seat.variantId ?? null,
        barberId: seat.barberId,
        // What the client ASKED for, beside what they got — the flag that
        // tells staff on a sick day which bookings can move chairs.
        barberPref: seat.pref,
        terms: {
          priceMinorUnits,
          currencyCode: 'EUR',
          // The fixture's own minutes when it names them: a visit booked
          // shorter or longer than the catalogue is what the frame's tag
          // exists to show.
          durationMinutes: minutes,
          setupMinutes: 0,
          cleanupMinutes: 0,
          // What the catalogue said, kept beside a re-timing exactly as a
          // staff override keeps it (`resolveTerms` in the functions'
          // `decide-booking.ts`): the price is the catalogue's own, the
          // minutes are not. So the seat reads `overridden()` and the visit
          // sheet marks it custom, as it would a real one. Terms the
          // catalogue sells as they are record nothing — the reader drops
          // an "override" that changes nothing.
          catalogPriceMinorUnits: retimed ? priceMinorUnits : null,
          catalogDurationMinutes: retimed ? catalogMinutes : null,
        },
        slot: {
          startIso: calendar.isoAt(fixture.dayOffset, seat.hour, seat.minute),
          endIso: calendar.isoAt(
            fixture.dayOffset,
            seat.hour,
            seat.minute + minutes,
          ),
          zone: calendar.zone,
        },
        subject: seat.subject,
        outcome,
        tipMinorUnits: tip,
      },
    };
  });

  const first = seats.reduce((a, b) =>
    b.window.startMs < a.window.startMs ? b : a,
  );
  const last = seats.reduce((a, b) =>
    b.window.endMs > a.window.endMs ? b : a,
  );
  if (fixture.bookedAt) {
    const bookedMs = Date.parse(zoned(calendar, fixture.bookedAt).iso);
    if (bookedMs >= first.window.startMs || bookedMs > calendar.nowMs) {
      throw new Error(`seed: ${fixture.id} is booked after it starts`);
    }
  }

  const accounts = seats
    .map(({ document }) => document.subject)
    .filter((subject) => subject.kind === 'account');
  const self = accounts.find((subject) => subject.relationship === 'self');
  const distinct = (values) => [...new Set(values)];

  return {
    id: fixture.id,
    doc: {
      locationId: fixture.locationId ?? 'loc-center',
      ownerUserId: self?.userId ?? null,
      // The R33 mirror: every PERSON on the visit, sorted — the only way the
      // stats trigger finds a companion's history.
      subjectUserIds: distinct(
        accounts.map((subject) => subject.userId),
      ).sort(),
      placement: fixture.placement,
      barberIds: distinct(seats.map(({ document }) => document.barberId)),
      // The rebuild trigger's reverse index — one key per (barber, day) this
      // appointment occupies. `array-contains` on it is how one cancelled
      // booking recomputes exactly the busy docs it touched.
      busyKeys: distinct(
        seats.map(
          ({ document }) =>
            `${document.barberId}__${document.slot.startIso.slice(0, 10)}`,
        ),
      ).sort(),
      timeSlot: {
        startIso: first.document.slot.startIso,
        endIso: last.document.slot.endIso,
        zone: calendar.zone,
      },
      seats: seats.map(({ document }) => document),
      status: fixture.status,
      bookedAt: fixture.bookedAt ? zoned(calendar, fixture.bookedAt) : null,
      bookedFromAppointmentId: fixture.bookedFromAppointmentId ?? null,
      arrivedAt: fixture.arrivedAt
        ? zoned(calendar, {
            dayOffset: fixture.dayOffset,
            ...fixture.arrivedAt,
          })
        : null,
      contact: fixture.contact ?? null,
      discounts: [],
      voucherRedemptions: [],
    },
  };
}
