/**
 * The `appointments/{id}` documents the e2e suite seeds — an upcoming visit
 * and a worked one, one builder for both — as pure values.
 *
 * Kept apart from `seed-firestore.ts` (the Admin SDK writes) so a unit test
 * can hold it against the real mapper: `apps/web/src/testing/
 * e2e-appointment-seed.spec.ts` reads it through `appointmentFromDocument`,
 * writes it back through `appointmentToDocument` and compares the bytes and
 * the field set, for BOTH visits (and holds the worked one's seat outcome
 * and booking instant). That spec is the guard; this file is hand-written
 * because Playwright's transform cannot load the domain libs (it rejects
 * their `declare` fields), and `tools/seed` is `scope:tooling`, which
 * `scope:web` may not import.
 *
 * Firebase-free and Node-free on purpose: the web unit-test build compiles
 * it too.
 */

/** The shop's zone: every seeded slot is shop time. */
export const SHOP_ZONE = 'Europe/Sofia';

/** The dev catalogue's chair every seeded visit books: Ivan's beard trim at
 *  the Center, at the price and length the catalogue sells it for. */
export const DEV_CHAIR = {
  locationId: 'loc-center',
  barberId: 'ivan',
  serviceId: 'svc-beard',
  priceMinorUnits: 1000,
  currencyCode: 'EUR',
  durationMinutes: 30,
} as const;

/** A fixed instant, so a seeded row is the same bytes on every run. */
const BOOKED_AT_ISO = '2026-09-01T12:00:00.000+03:00';

/** `HH:mm:ss` + 30 minutes, plain string arithmetic (no `Date`/luxon — those
 * are off-limits outside `libs/domain/kernel`/`libs/infrastructure`, see
 * `docs/architecture/module-boundaries.md`); ignores day rollover, fine for
 * fixture start times picked well clear of midnight. */
function plus30Minutes(iso: string): string {
  const [datePart = '', timePart = '00:00:00'] = iso.split('T');
  const [h = 0, m = 0, s = 0] = timePart.split(':').map(Number);
  let hours = h;
  let minutes = m + 30;
  if (minutes >= 60) {
    minutes -= 60;
    hours += 1;
  }
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${datePart}T${pad(hours)}:${pad(minutes)}:${pad(s)}`;
}

/**
 * Rewrites a naive `YYYY-MM-DDTHH:mm:ss` shop wall-clock string into the
 * canonical offset-suffixed form `appointmentToDocument` writes for every
 * slot (`ZonedDateTime#toISO()`, Luxon under the hood: `.SSS±HH:MM`), so a
 * seeded row is the bytes a real booking would have stored. Uses `Intl` (not
 * `Date` arithmetic/luxon) to look up the zone's UTC offset, read at the same
 * wall-clock reading taken as UTC — exact for fixture times from 06:00 on,
 * which is past every European DST switch (01:00 UTC).
 */
function toCanonicalIso(localIso: string, zone: string): string {
  const [datePart = '', timePart = '00:00:00'] = localIso.split('T');
  const [year = 1970, month = 1, day = 1] = datePart.split('-').map(Number);
  const [hour = 0, minute = 0, second = 0] = timePart.split(':').map(Number);
  const asIfUtc = new Date(
    Date.UTC(year, month - 1, day, hour, minute, second),
  );
  const offsetPart = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    timeZoneName: 'longOffset',
  })
    .formatToParts(asIfUtc)
    .find((part) => part.type === 'timeZoneName')?.value;
  const offset = offsetPart?.replace('GMT', '') || '+00:00';
  return `${datePart}T${timePart}.000${offset}`;
}

/**
 * `YYYY-MM-DD` moved `days` back on the calendar. Day arithmetic in UTC,
 * where every day is 24 hours long, so no zone and no DST can shift it; the
 * result is still a naive shop-calendar day.
 */
function daysBefore(day: string, days: number): string {
  const [year = 1970, month = 1, date = 1] = day.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, date - days))
    .toISOString()
    .slice(0, 10);
}

/** What became of a seeded visit: still ahead, or worked at the chair. */
type VisitFate = 'upcoming' | 'worked';

/**
 * A visit `ownerUserId` booked for themselves in the dev catalogue's chair,
 * starting at the naive shop-time `startIso` (`YYYY-MM-DDTHH:mm:ss`,
 * between 06:00 and 23:29).
 *
 * Every field of `APPOINTMENT_DOCUMENT_FIELDS`, the query mirrors
 * (`subjectUserIds`, `barberIds`, `busyKeys`, `timeSlot`) and the commit's
 * `placement` stamp included, in exactly `appointmentToDocument`'s shape —
 * both the browser and the functions read it with `appointmentFromDocument`,
 * which refuses a seat without its barber, terms or slot.
 */
function chairVisitDocument(
  id: string,
  ownerUserId: string,
  startIso: string,
  fate: VisitFate,
): Record<string, unknown> {
  const slot = {
    startIso: toCanonicalIso(startIso, SHOP_ZONE),
    endIso: toCanonicalIso(plus30Minutes(startIso), SHOP_ZONE),
    zone: SHOP_ZONE,
  };
  const day = startIso.slice(0, 10);
  const worked = fate === 'worked';
  return {
    locationId: DEV_CHAIR.locationId,
    ownerUserId,
    subjectUserIds: [ownerUserId],
    // The client booked it themselves.
    placement: 'self',
    barberIds: [DEV_CHAIR.barberId],
    busyKeys: [`${DEV_CHAIR.barberId}__${day}`],
    timeSlot: slot,
    seats: [
      {
        id: `${id}-seat`,
        serviceId: DEV_CHAIR.serviceId,
        variantId: null,
        barberId: DEV_CHAIR.barberId,
        barberPref: 'specific',
        terms: {
          priceMinorUnits: DEV_CHAIR.priceMinorUnits,
          currencyCode: DEV_CHAIR.currencyCode,
          durationMinutes: DEV_CHAIR.durationMinutes,
          setupMinutes: 0,
          cleanupMinutes: 0,
          catalogPriceMinorUnits: null,
          catalogDurationMinutes: null,
        },
        slot,
        subject: {
          kind: 'account',
          userId: ownerUserId,
          relationship: 'self',
        },
        // Worked at the slot's end, as the dev seed stamps its past visits
        // and as the reader derives a legacy `completed` row's seat.
        outcome: worked
          ? { kind: 'worked', atMs: Date.parse(slot.endIso) }
          : { kind: 'scheduled' },
        tipMinorUnits: null,
      },
    ],
    status: { kind: worked ? 'completed' : 'confirmed' },
    // Booked before it happened: a past visit a week ahead at noon, an
    // upcoming one at a fixed instant (the same bytes on every run).
    bookedAt: {
      iso: worked
        ? toCanonicalIso(`${daysBefore(day, 7)}T12:00:00`, SHOP_ZONE)
        : BOOKED_AT_ISO,
      zone: SHOP_ZONE,
    },
    bookedFromAppointmentId: null,
    arrivedAt: null,
    contact: null,
    discounts: [],
    voucherRedemptions: [],
  };
}

/**
 * A confirmed visit `ownerUserId` booked for themselves in the dev
 * catalogue's chair, starting at `startIso` — see {@link chairVisitDocument}.
 * The fixed booking instant is in 2026, so pick a start after it.
 */
export function upcomingAppointmentDocument(
  id: string,
  ownerUserId: string,
  startIso: string,
): Record<string, unknown> {
  return chairVisitDocument(id, ownerUserId, startIso, 'upcoming');
}

/**
 * A finished visit: the same chair, `completed`, its one seat `worked` at
 * the slot's end and booked a week before — the visit a client repeats with
 * `/book?repeat=` (see {@link chairVisitDocument}). Pick a start in the past.
 */
export function workedAppointmentDocument(
  id: string,
  ownerUserId: string,
  startIso: string,
): Record<string, unknown> {
  return chairVisitDocument(id, ownerUserId, startIso, 'worked');
}
