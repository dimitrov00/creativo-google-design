import fc from 'fast-check';
import { BookingLifecycle } from '@core/components';
import {
  CustomerId,
  LocalDate,
  MinuteOfDay,
  type TimeZone,
  UserId,
  UtcEpochMs,
} from '@core/primitives';
import { AppointmentIndexSystem, ZonedTimeSystem } from '@core/systems';
import { fixtureHash } from '@core/testing';
import {
  type AppointmentBody,
  DEV_CHAIR,
  upcomingAppointmentBody,
  workedAppointmentBody,
} from '../../e2e/support/appointment-seed-document';
import { SHOP_ZONE } from '../../e2e/support/shop-clock';

/**
 * The e2e suite's appointment seed, held to the archetype (flip 1: the
 * document IS the flat `Appointment` minus its `id`, Law 5).
 *
 * `apps/web/e2e/support/appointment-seed-document.ts` builds its bodies with
 * the entity's own companions and `satisfies` the entity, which the type
 * checker holds; what no type can say is held here: the query mirrors are
 * the ones every write plan recomputes from the seats, the one instant is
 * the shop's wall clock read in the shop's zone (on either side of a DST
 * switch), the body is exactly one lifecycle variant, and the stored tags
 * are the ones the screens and the e2e assertions read (F1-9). A drift
 * either way has cost the suite before: a seat a reader could not place
 * left the screens on skeletons with no error to read. This is the one
 * runner that type-checks the e2e helper, which is why a guard for it lives
 * under `src/`.
 *
 * BOTH visits the suite seeds are held to it — the upcoming one the account
 * screens list, and the worked one `/book?repeat=` repeats — each at a start
 * its specs use (the worked one in winter time, the upcoming one in summer).
 */
const VISITS = [
  {
    fate: 'upcoming',
    build: upcomingAppointmentBody,
    start: '2030-06-01T10:00:00',
    startsAtOffset: '2030-06-01T10:00:00.000+03:00',
    bookingStatus: 'CONFIRMED',
    attendanceState: 'SCHEDULED',
  },
  {
    fate: 'worked',
    build: workedAppointmentBody,
    start: '2026-03-10T10:00:00',
    startsAtOffset: '2026-03-10T10:00:00.000+02:00',
    bookingStatus: 'COMPLETED',
    attendanceState: 'WORKED',
  },
] as const;

const ID = 'appt-e2e-guard';
const OWNER = 'e2e-guard-owner';
const CUSTOMER = CustomerId.forUser(UserId.of(OWNER), fixtureHash);

function zoneOf(raw: string): TimeZone {
  const zone = ZonedTimeSystem.checkZone(raw);
  if (!zone.ok) throw new Error(`no zone ${raw}`);
  return zone.value;
}
const ZONE = zoneOf(SHOP_ZONE);

/** Every lifecycle stamp a root variant may carry. */
const LIFECYCLE_FIELDS = [
  'pendingAtUtcMs',
  'confirmedAtUtcMs',
  'completedAtUtcMs',
  'noShowAtUtcMs',
  'cancelledAtUtcMs',
  'cancellationReason',
];

/** The instant an offset ISO string names. */
function instantOf(iso: string): number {
  const parsed = ZonedTimeSystem.parseOffsetIso(iso);
  if (!parsed.ok) throw new Error(`not an instant: ${iso}`);
  return parsed.value;
}

/** Holds one body to the mirrors, the envelope and the shop's clock. */
function expectArchetype(body: AppointmentBody): void {
  const keys = AppointmentIndexSystem.queryKeys(body);
  expect({
    ownerUserId: body.ownerUserId,
    subjectUserIds: body.subjectUserIds,
    ownerCustomerId: body.ownerCustomerId,
    subjectCustomerIds: body.subjectCustomerIds,
    barberIds: body.barberIds,
    busyKeys: body.busyKeys,
  }).toEqual({
    ownerUserId: keys.ownerUserId,
    subjectUserIds: keys.subjectUserIds,
    ownerCustomerId: keys.ownerCustomerId,
    subjectCustomerIds: keys.subjectCustomerIds,
    barberIds: keys.barberIds,
    busyKeys: keys.busyKeys,
  });
  const envelope = AppointmentIndexSystem.envelope(body);
  expect(envelope).toEqual({
    startMinutes: body.startMinutes,
    endMinutes: body.endMinutes,
  });
  const start = ZonedTimeSystem.toUtc(body.localDate, body.startMinutes, ZONE);
  expect(start).toEqual({ ok: true, value: body.utcEpochMs });
  // Exactly one lifecycle variant at the root: its own stamps, no other's.
  const record = body as unknown as Record<string, unknown>;
  expect(LIFECYCLE_FIELDS.filter((field) => field in record)).toEqual(
    Object.keys(BookingLifecycle.sliceOf(body)).filter(
      (field) => field !== 'bookingStatus',
    ),
  );
  // Plain data: what is written is what is read, byte for byte.
  expect(JSON.parse(JSON.stringify(body))).toEqual(body);
}

// `test` rather than `it`, and a loop rather than `each`: apps/web lints with
// eslint-plugin-playwright, whose `no-standalone-expect` recognises `test()`
// only.
describe('the e2e appointment seed', () => {
  for (const visit of VISITS) {
    describe(`the ${visit.fate} visit`, () => {
      test('is the flat archetype: its mirrors, its envelope, its instant, one variant', () => {
        expectArchetype(visit.build(ID, OWNER, CUSTOMER, visit.start));
      });

      test('names the account AND its client record, two keys beside each other', () => {
        const body = visit.build(ID, OWNER, CUSTOMER, visit.start);
        expect(body.ownerUserId).toBe(OWNER);
        expect(body.subjectUserIds).toEqual([OWNER]);
        expect(body.ownerCustomerId).toBe(CUSTOMER);
        expect(body.subjectCustomerIds).toEqual([CUSTOMER]);
        expect(body.seats[0]).toMatchObject({
          seatSubject: 'ACCOUNT',
          subjectUserId: OWNER,
          subjectCustomerId: CUSTOMER,
          subjectRelationship: 'SELF',
        });
      });

      test('describes the visit the specs assert on, by the stored tags they read', () => {
        const body = visit.build(ID, OWNER, CUSTOMER, visit.start);
        expect(body.bookingStatus).toBe(visit.bookingStatus);
        expect(body.placement).toBe('SELF');
        expect(body.locationId).toBe(DEV_CHAIR.locationId);
        expect(body.barberIds).toEqual([DEV_CHAIR.barberId]);
        const [seat] = body.seats;
        expect(seat).toMatchObject({
          serviceId: DEV_CHAIR.serviceId,
          barberId: DEV_CHAIR.barberId,
          barberPreference: 'SPECIFIC',
          priceCents: DEV_CHAIR.priceCents,
          currency: DEV_CHAIR.currency,
          durationMinutes: DEV_CHAIR.durationMinutes,
          catalogPriceCents: null,
          catalogDurationMinutes: null,
          attendanceState: visit.attendanceState,
          tipCents: null,
        });
        // 10:00 on the SHOP's wall clock, whatever zone the runner is in —
        // and the instant that wall clock is there that day.
        expect(body.localDate).toBe(visit.start.slice(0, 10));
        expect(body.startMinutes).toBe(10 * 60);
        expect(body.utcEpochMs).toBe(instantOf(visit.startsAtOffset));
        expect(ZonedTimeSystem.toIso(body.utcEpochMs, ZONE)).toBe(
          visit.startsAtOffset,
        );
      });

      test('reads on the shop’s clock for any shop-hours start, on either side of a DST switch', () => {
        const day = fc
          .integer({
            min: LocalDate.epochDayOf(2026, 1, 1),
            max: LocalDate.epochDayOf(2035, 12, 31),
          })
          .map((epochDay) => LocalDate.fromEpochDay(epochDay));
        // 06:00–23:25 in five-minute steps: the fixture contract (the end is
        // start + 30 minutes on the same day).
        const minute = fc.integer({ min: 6 * 12, max: 23 * 12 + 5 });

        fc.assert(
          fc.property(day, minute, (date, step) => {
            const pad = (n: number) => String(n).padStart(2, '0');
            const clock = `${pad(Math.floor(step / 12))}:${pad((step % 12) * 5)}`;
            const naive = `${date}T${clock}:00`;
            const body = visit.build(ID, OWNER, CUSTOMER, naive);
            expectArchetype(body);
            expect(body.bookingStatus).toBe(visit.bookingStatus);
            expect(body.localDate).toBe(date);
            expect(body.startMinutes).toBe(step * 5);
            expect(body.endMinutes - body.startMinutes).toBe(
              DEV_CHAIR.durationMinutes,
            );
            // The offset is Sofia's on THAT day — what a real booking stores.
            const opened = MinuteOfDay.of(step * 5);
            if (!opened.ok) throw new Error('unreachable');
            expect(ZonedTimeSystem.toUtc(date, opened.value, ZONE)).toEqual({
              ok: true,
              value: body.utcEpochMs,
            });
            expect(
              ZonedTimeSystem.toIso(body.utcEpochMs, ZONE).slice(0, 16),
            ).toBe(`${date}T${clock}`);
          }),
          { numRuns: 300 },
        );
      });
    });
  }

  describe('the worked visit, as `/book?repeat=` reads it', () => {
    test('was worked as its chair freed, completed then, and booked before it began', () => {
      const body = workedAppointmentBody(
        ID,
        OWNER,
        CUSTOMER,
        '2026-03-10T10:00:00',
      );
      // The chair frees thirty minutes in — no DST switch in shop hours.
      const freed = UtcEpochMs.plusMs(
        body.utcEpochMs,
        DEV_CHAIR.durationMinutes * 60_000,
      );
      expect(body.seats[0]).toMatchObject({
        attendanceState: 'WORKED',
        workedAtUtcMs: freed,
      });
      expect(body).toMatchObject({
        bookingStatus: 'COMPLETED',
        completedAtUtcMs: freed,
      });
      // `null` would read as "not recorded" and fail the comparison below.
      expect(body.bookedAtUtcMs ?? Number.NaN).toBeLessThan(body.utcEpochMs);
    });
  });
});
