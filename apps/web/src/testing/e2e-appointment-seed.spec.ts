import fc from 'fast-check';
import {
  APPOINTMENT_DOCUMENT_FIELDS,
  ZonedDateTime,
  appointmentFromDocument,
  appointmentToDocument,
  placementFromDocument,
} from '@creativo/application/booking';
import {
  DEV_CHAIR,
  SHOP_ZONE,
  upcomingAppointmentDocument,
  workedAppointmentDocument,
} from '../../e2e/support/appointment-seed-document';

/**
 * The e2e suite's appointment seed, held to the real mapper.
 *
 * `apps/web/e2e/support/appointment-seed-document.ts` is hand-written — the
 * Playwright transform cannot load the domain libs, and `tools/seed` is
 * off limits to `scope:web` — so nothing else stops it drifting from what
 * production writes. A drift either way has cost the suite before: a seat
 * the reader refused left the screens on skeletons with no error to read,
 * and a field the writer grew would leave the suite testing a shape
 * production no longer stores. This is the one runner that can load both,
 * which is why a guard for an e2e helper lives under `src/`.
 *
 * BOTH visits the suite seeds are held to it — the upcoming one the account
 * screens list, and the worked one `/book?repeat=` repeats — each at a start
 * its specs use (the worked one in winter time, the upcoming one in summer).
 */
const VISITS = [
  {
    fate: 'upcoming',
    build: upcomingAppointmentDocument,
    start: '2030-06-01T10:00:00',
    startIso: '2030-06-01T10:00:00.000+03:00',
    status: 'confirmed',
  },
  {
    fate: 'worked',
    build: workedAppointmentDocument,
    start: '2026-03-10T10:00:00',
    startIso: '2026-03-10T10:00:00.000+02:00',
    status: 'completed',
  },
] as const;

const ID = 'appt-e2e-guard';
const OWNER = 'e2e-guard-owner';

/** Read, then written back exactly as a real save would write it. */
function roundTrip(doc: Record<string, unknown>) {
  const parsed = appointmentFromDocument(ID, doc);
  if (parsed.isFailure()) {
    throw new Error(`the reader refused the seed: ${parsed.error.message}`);
  }
  return {
    appointment: parsed.value,
    written: appointmentToDocument(parsed.value, {
      placement: placementFromDocument(doc),
    }),
  };
}

// `test` rather than `it`, and a loop rather than `each`: apps/web lints with
// eslint-plugin-playwright, whose `no-standalone-expect` recognises `test()`
// only.
describe('the e2e appointment seed', () => {
  for (const visit of VISITS) {
    describe(`the ${visit.fate} visit`, () => {
      test('is a document the reader accepts', () => {
        const doc = visit.build(ID, OWNER, visit.start);
        expect(appointmentFromDocument(ID, doc).isSuccess()).toBe(true);
      });

      test('is byte for byte what the writer stores for the visit it describes', () => {
        const doc = visit.build(ID, OWNER, visit.start);
        expect(roundTrip(doc).written).toEqual(doc);
      });

      test('holds exactly the fields the mapper owns — no more, no fewer', () => {
        const doc = visit.build(ID, OWNER, visit.start);
        expect(Object.keys(doc).sort()).toEqual(
          [...APPOINTMENT_DOCUMENT_FIELDS].sort(),
        );
      });

      test('describes the visit the specs assert on', () => {
        const { appointment } = roundTrip(visit.build(ID, OWNER, visit.start));
        expect(appointment.status.kind).toBe(visit.status);
        expect(appointment.locationId.value).toBe(DEV_CHAIR.locationId);
        expect(appointment.barberIds().map((id) => id.value)).toEqual([
          DEV_CHAIR.barberId,
        ]);
        // 10:00 in the SHOP's zone, whatever zone the runner is in.
        expect(appointment.timeSlot.start.toISO()).toBe(visit.startIso);
        expect(appointment.timeSlot.start.zoneName).toBe(SHOP_ZONE);
      });

      test('round-trips for any shop-hours start, on either side of a DST switch', () => {
        const day = fc
          .date({
            min: new Date('2026-01-01T00:00:00Z'),
            max: new Date('2035-12-31T00:00:00Z'),
            noInvalidDate: true,
          })
          .map((date) => date.toISOString().slice(0, 10));
        // 06:00–23:25 in five-minute steps: the fixture contract (the end is
        // start + 30 minutes on the same day).
        const time = fc
          .integer({ min: 6 * 12, max: 23 * 12 + 5 })
          .map((step) => {
            const pad = (n: number) => String(n).padStart(2, '0');
            return `${pad(Math.floor(step / 12))}:${pad((step % 12) * 5)}:00`;
          });

        fc.assert(
          fc.property(day, time, (date, clock) => {
            const naive = `${date}T${clock}`;
            const doc = visit.build(ID, OWNER, naive);
            const { appointment, written } = roundTrip(doc);
            expect(written).toEqual(doc);
            expect(appointment.status.kind).toBe(visit.status);
            // The offset is Sofia's on THAT day — what a real booking stores.
            const expected = ZonedDateTime.fromISO(naive, SHOP_ZONE);
            if (expected.isFailure()) throw new Error('unreachable');
            expect(appointment.timeSlot.start.toISO()).toBe(
              expected.value.toISO(),
            );
            expect(
              appointment.timeSlot.start.minutesUntil(appointment.timeSlot.end),
            ).toBe(DEV_CHAIR.durationMinutes);
          }),
          { numRuns: 300 },
        );
      });
    });
  }

  describe('the worked visit, as `/book?repeat=` reads it', () => {
    test('was worked at its slot’s end, and booked before it began', () => {
      const { appointment } = roundTrip(
        workedAppointmentDocument(ID, OWNER, '2026-03-10T10:00:00'),
      );
      expect(appointment.seats[0]?.outcome).toEqual({
        kind: 'worked',
        atMs: appointment.timeSlot.end.toMillis(),
      });
      // `null` would read as "not recorded" and fail the comparison below.
      expect(appointment.bookedAt?.toMillis() ?? Number.NaN).toBeLessThan(
        appointment.timeSlot.start.toMillis(),
      );
    });
  });
});
