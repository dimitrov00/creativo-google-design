import type { Firestore } from 'firebase-admin/firestore';
import { describe, expect, it, vi } from 'vitest';
import {
  AppointmentId,
  BarberId,
  BusyKey,
  LocalDate,
  ScheduleExceptionId,
  UtcEpochMs,
} from '@core/primitives';
import { RepositoryError, RepositoryErrorCode } from '@core/errors';
import { type Appointment, Collections } from '@core/entities';
import type { Log } from '@core/ports';
import { StoredDocumentSystem } from '@core/systems';
import {
  ANALYTICS_FIXTURE_BARBERS,
  analyticsFixtureDayDocuments,
  FIXTURE_NOW_UTC_MS,
  appointmentFixture,
  barberFixture,
  localDate,
  locationFixture,
  recordingTelemetry,
  scheduleExceptionFixture,
  unguarded,
} from '@core/testing';
import { createProjectionFirestore } from '../test-support/fake-projection-firestore';
import {
  firestoreAnalyticsDayPorts,
  firestoreAnalyticsPorts,
} from './firestore-analytics.adapter';
import { bodyOf } from './store-answer';

/*
 * Staff analytics' reads over the in-memory Admin SDK: the visits by busy
 * key and the follow-ups by id in queries of 30, concatenated; the booking
 * range half-open; one barber's departures by date; every barber record and
 * shop. Every query is read at its cap + 1 and refused past it; the guard
 * fails a read at its first malformed visit.
 */

const NO_LOG: Log = () => undefined;
const IVAN = BarberId.of('ivan');
const NIKO = BarberId.of('niko');
const SEPTEMBER = LocalDate.range(
  localDate('2026-09-01'),
  localDate('2026-09-30'),
);

type Data = Record<string, unknown>;

function visit(
  id: string,
  day: string,
  barbers: readonly BarberId[],
  extra: Partial<Appointment> = {},
): Appointment {
  return appointmentFixture({
    id: AppointmentId.of(id),
    localDate: localDate(day),
    busyKeys: barbers.map((barber) => BusyKey.of(barber, localDate(day))),
    ...extra,
  });
}

function seeded(
  visits: readonly Appointment[],
  extra: Record<string, Data> = {},
) {
  const docs: Record<string, Data> = { ...extra };
  for (const v of visits) {
    docs[`${Collections.Appointments}/${v.id}`] = bodyOf(v);
  }
  return createProjectionFirestore(docs);
}

const portsOf = (fake: ReturnType<typeof createProjectionFirestore>) =>
  firestoreAnalyticsPorts(fake.db as unknown as Firestore, unguarded, NO_LOG);

describe('firestoreAnalyticsPorts — visits by busy key', () => {
  it('splits the keys into queries of 30 and answers every query’s rows in order — a two-chunk party twice', async () => {
    const solo = visit('v-solo', '2026-09-14', [IVAN]);
    const party = visit('v-party', '2026-09-15', [IVAN, NIKO]);
    const other = visit('v-other', '2026-08-10', [IVAN]);
    const ports = portsOf(seeded([solo, party, other]));
    const keys = [
      ...SEPTEMBER.map((day) => BusyKey.of(IVAN, day)),
      ...SEPTEMBER.map((day) => BusyKey.of(NIKO, day)),
    ];
    const answer = await ports.loadVisitsByBusyKeys(keys);
    // Ivan's 30 keys hold both visits (in document order), Niko's the party.
    expect(answer.ok && answer.value.map((v) => v.id)).toEqual([
      party.id,
      solo.id,
      party.id,
    ]);
    expect(answer.ok && answer.value[1]).toEqual(solo);
  });

  it('reads nothing for no keys', async () => {
    const ports = portsOf(seeded([visit('v', '2026-09-14', [IVAN])]));
    expect(await ports.loadVisitsByBusyKeys([])).toEqual({
      ok: true,
      value: [],
    });
  });

  it('refuses a query past its cap — 60 visits a barber-day — instead of truncating it', async () => {
    const crowded = Array.from({ length: 61 }, (_, i) =>
      visit(`v-${i}`, '2026-09-14', [IVAN]),
    );
    const ports = portsOf(seeded(crowded));
    const key = BusyKey.of(IVAN, localDate('2026-09-14'));
    expect(await ports.loadVisitsByBusyKeys([key])).toEqual({
      ok: false,
      error: RepositoryError.readFailed(
        Collections.Appointments,
        'resource-exhausted',
      ),
    });
    // At the cap itself the read answers in full.
    const atCap = portsOf(seeded(crowded.slice(0, 60)));
    const answer = await atCap.loadVisitsByBusyKeys([key]);
    expect(answer.ok && answer.value).toHaveLength(60);
  });

  it('fails the read at a malformed visit, logged once — never a shorter list', async () => {
    const good = visit('v-good', '2026-09-14', [IVAN]);
    const bad = visit('v-bad', '2026-09-14', [IVAN]);
    const fake = seeded([good], {
      [`${Collections.Appointments}/${bad.id}`]: {
        ...bodyOf(bad),
        seats: [{ ...bad.seats[0], durationMinutes: 0 }],
      },
    });
    const telemetry = recordingTelemetry();
    const ports = firestoreAnalyticsPorts(
      fake.db as unknown as Firestore,
      StoredDocumentSystem.guardOf,
      telemetry.log,
    );
    const answer = await ports.loadVisitsByBusyKeys([
      BusyKey.of(IVAN, localDate('2026-09-14')),
    ]);
    expect(answer).toEqual({
      ok: false,
      error: {
        errorCode: RepositoryErrorCode.Malformed,
        path: `${Collections.Appointments}/${bad.id}`,
        reason: 'seats[0].durationMinutes',
      },
    });
    expect(telemetry.lines).toHaveLength(1);
  });

  it('admits a well-formed visit through the real guard as stored', async () => {
    const good = visit('v-good', '2026-09-14', [IVAN]);
    const ports = firestoreAnalyticsPorts(
      seeded([good]).db as unknown as Firestore,
      StoredDocumentSystem.guardOf,
      NO_LOG,
    );
    expect(
      await ports.loadVisitsByBusyKeys([
        BusyKey.of(IVAN, localDate('2026-09-14')),
      ]),
    ).toEqual({ ok: true, value: [good] });
  });
});

describe('firestoreAnalyticsPorts — follow-ups', () => {
  const from = (id: string, i: number) =>
    visit(`f-${i}`, '2026-10-12', [IVAN], {
      bookedFromAppointmentId: AppointmentId.of(id),
    });

  it('reads one barber’s follow-ups by the visits they follow, 30 ids a query', async () => {
    const sources = Array.from({ length: 31 }, (_, i) =>
      AppointmentId.of(`v-${i}`),
    );
    const first = from('v-0', 1);
    const last = from('v-30', 2);
    const stray = from('v-other', 3);
    const ports = portsOf(seeded([first, last, stray]));
    const answer = await ports.loadFollowUpsOf(sources);
    expect(answer.ok && answer.value.map((v) => v.id)).toEqual([
      first.id,
      last.id,
    ]);
  });

  it('refuses a chunk past 5 follow-ups a visit', async () => {
    const many = Array.from({ length: 6 }, (_, i) => from('v-0', i));
    const ports = portsOf(seeded(many));
    const answer = await ports.loadFollowUpsOf([AppointmentId.of('v-0')]);
    expect(answer.ok).toBe(false);
    expect(!answer.ok && answer.error.reason).toBe('resource-exhausted');
  });

  it('reads the shop’s visits booked in a half-open instant range', async () => {
    const at = (ms: number) => UtcEpochMs.plusMs(FIXTURE_NOW_UTC_MS, ms);
    const before = visit('v-before', '2026-09-20', [IVAN], {
      bookedAtUtcMs: at(-1),
    });
    const inside = visit('v-inside', '2026-09-20', [IVAN], {
      bookedAtUtcMs: at(0),
    });
    const atEnd = visit('v-end', '2026-09-20', [IVAN], {
      bookedAtUtcMs: at(1000),
    });
    const ports = portsOf(seeded([before, inside, atEnd]));
    const answer = await ports.loadFollowUpsBookedIn(at(0), at(1000));
    expect(answer.ok && answer.value.map((v) => v.id)).toEqual([inside.id]);
  });
});

describe('firestoreAnalyticsPorts — the shop', () => {
  it('reads one barber’s departures over a date range, both ends included', async () => {
    const on = (barberId: BarberId, day: string) =>
      scheduleExceptionFixture({
        id: ScheduleExceptionId.of(BusyKey.of(barberId, localDate(day))),
        barberId,
        localDate: localDate(day),
      });
    const docs: Record<string, Data> = {};
    const rows = [
      on(IVAN, '2026-08-31'),
      on(IVAN, '2026-09-01'),
      on(IVAN, '2026-09-30'),
      on(IVAN, '2026-10-01'),
      on(NIKO, '2026-09-10'),
    ];
    for (const row of rows) {
      docs[`${Collections.ScheduleExceptions}/${row.id}`] = bodyOf(row);
    }
    const ports = portsOf(createProjectionFirestore(docs));
    const answer = await ports.loadDeparturesForBarber(
      IVAN,
      localDate('2026-09-01'),
      localDate('2026-09-30'),
    );
    expect(answer.ok && answer.value).toEqual([rows[1], rows[2]]);
  });

  it('lists every barber record and every shop, any status', async () => {
    const ivan = barberFixture({ id: IVAN });
    const retired = barberFixture({ id: NIKO });
    const shop = locationFixture();
    const ports = portsOf(
      createProjectionFirestore({
        [`${Collections.Barbers}/${IVAN}`]: bodyOf(ivan),
        [`${Collections.Barbers}/${NIKO}`]: bodyOf(retired),
        [`${Collections.Locations}/${shop.id}`]: bodyOf(shop),
      }),
    );
    expect(await ports.listBarberRecordIds()).toEqual({
      ok: true,
      value: [IVAN, NIKO],
    });
    expect(await ports.listLocations()).toEqual({ ok: true, value: [shop] });
  });

  it('answers a read that throws as a value, the canonical code its reason', async () => {
    const fake = seeded([]);
    vi.spyOn(fake.db, 'collection').mockImplementation(() => {
      throw Object.assign(new Error('14 UNAVAILABLE'), { code: 14 });
    });
    const ports = portsOf(fake);
    expect(await ports.listLocations()).toEqual({
      ok: false,
      error: RepositoryError.readFailed(Collections.Locations, 'unavailable'),
    });
    expect(
      await ports.loadVisitsByBusyKeys([
        BusyKey.of(IVAN, localDate('2026-09-14')),
      ]),
    ).toEqual({
      ok: false,
      error: RepositoryError.readFailed(
        Collections.Appointments,
        'unavailable',
      ),
    });
  });
});

describe('firestoreAnalyticsDayPorts — the stored days (staff analytics v2)', () => {
  const DAYS = analyticsFixtureDayDocuments();
  const { ivan, maria } = ANALYTICS_FIXTURE_BARBERS;
  const dayOf = (barber: BarberId, day: string) =>
    DAYS.find((d) => String(d.id) === BusyKey.of(barber, localDate(day)));

  function seededDays(extra: Record<string, Data> = {}) {
    const docs: Record<string, Data> = {};
    for (const day of DAYS) {
      docs[`${Collections.AnalyticsDays}/${day.id}`] = bodyOf(day);
    }
    // `extra` overrides a fixture day of the same key.
    return createProjectionFirestore({ ...docs, ...extra });
  }

  const dayPorts = (
    fake: ReturnType<typeof createProjectionFirestore>,
    log: Log = NO_LOG,
  ) => firestoreAnalyticsDayPorts(fake.db as unknown as Firestore, log);

  it('reads one barber’s days over an inclusive date range — the composite’s shape — bodies as stored', async () => {
    const ports = dayPorts(seededDays());
    const answer = await ports.loadAnalyticsDays(
      [ivan],
      localDate('2026-09-14'),
      localDate('2026-09-15'),
    );
    expect(answer).toEqual({
      ok: true,
      value: [dayOf(ivan, '2026-09-14'), dayOf(ivan, '2026-09-15')],
    });
  });

  it('reads the shop as one date range over the collection, keeping the barbers asked for', async () => {
    const ports = dayPorts(seededDays());
    const answer = await ports.loadAnalyticsDays(
      [ivan, maria],
      localDate('2026-09-15'),
      localDate('2026-09-15'),
    );
    expect(answer.ok && answer.value.map((d) => d.id).sort()).toEqual([
      BusyKey.of(ivan, localDate('2026-09-15')),
      BusyKey.of(maria, localDate('2026-09-15')),
    ]);
    expect(
      await ports.loadAnalyticsDays(
        [],
        localDate('2026-09-01'),
        localDate('2026-09-30'),
      ),
    ).toEqual({ ok: true, value: [] });
  });

  it('refuses a range past 366 days a barber instead of truncating it, and drops a malformed body with one line', async () => {
    const crowd: Record<string, Data> = {};
    for (let i = 0; i < 367; i++) {
      crowd[`${Collections.AnalyticsDays}/crowd-${i}`] = {
        ...bodyOf(dayOf(ivan, '2026-09-14') as (typeof DAYS)[number]),
        localDate: '2026-09-14',
      };
    }
    const over = dayPorts(createProjectionFirestore(crowd));
    expect(
      await over.loadAnalyticsDays(
        [ivan],
        localDate('2026-09-14'),
        localDate('2026-09-14'),
      ),
    ).toEqual({
      ok: false,
      error: RepositoryError.readFailed(
        Collections.AnalyticsDays,
        'resource-exhausted',
      ),
    });

    const telemetry = recordingTelemetry();
    const broken = dayPorts(
      seededDays({
        [`${Collections.AnalyticsDays}/${BusyKey.of(ivan, localDate('2026-09-16'))}`]:
          {
            ...bodyOf(dayOf(ivan, '2026-09-16') as (typeof DAYS)[number]),
            dayHourWorked: [1, 2, 3],
          },
      }),
      telemetry.log,
    );
    const answer = await broken.loadAnalyticsDays(
      [ivan],
      localDate('2026-09-15'),
      localDate('2026-09-17'),
    );
    expect(answer.ok && answer.value.map((d) => d.localDate)).toEqual([
      '2026-09-15',
      '2026-09-17',
    ]);
    expect(telemetry.lines).toEqual([
      {
        level: 'error',
        msg: 'malformed document refused',
        fields: {
          path: `${Collections.AnalyticsDays}/${BusyKey.of(ivan, localDate('2026-09-16'))}`,
          field: 'dayFigures',
        },
      },
    ]);
  });

  it('reads days by key with `getAll`: one answer per key in order, `null` where none or malformed', async () => {
    const telemetry = recordingTelemetry();
    const ports = dayPorts(
      seededDays({
        [`${Collections.AnalyticsDays}/${BusyKey.of(ivan, localDate('2026-09-16'))}`]:
          {
            odd: true,
          },
      }),
      telemetry.log,
    );
    const keys = [
      BusyKey.of(ivan, localDate('2026-09-14')),
      BusyKey.of(ivan, localDate('2026-09-27')),
      BusyKey.of(ivan, localDate('2026-09-16')),
      BusyKey.of(maria, localDate('2026-09-15')),
    ];
    expect(await ports.loadAnalyticsDaysByKeys(keys)).toEqual({
      ok: true,
      value: [
        dayOf(ivan, '2026-09-14'),
        null,
        null,
        dayOf(maria, '2026-09-15'),
      ],
    });
    expect(telemetry.lines).toHaveLength(1);
    expect(await ports.loadAnalyticsDaysByKeys([])).toEqual({
      ok: true,
      value: [],
    });
  });

  it('answers a read that throws as a value, the canonical code its reason', async () => {
    const fake = seededDays();
    vi.spyOn(fake.db, 'collection').mockImplementation(() => {
      throw Object.assign(new Error('14 UNAVAILABLE'), { code: 14 });
    });
    const ports = dayPorts(fake);
    const down = RepositoryError.readFailed(
      Collections.AnalyticsDays,
      'unavailable',
    );
    expect(
      await ports.loadAnalyticsDays(
        [ivan],
        localDate('2026-09-01'),
        localDate('2026-09-30'),
      ),
    ).toEqual({ ok: false, error: down });
    expect(
      await ports.loadAnalyticsDaysByKeys([
        BusyKey.of(ivan, localDate('2026-09-14')),
      ]),
    ).toEqual({ ok: false, error: down });
  });
});
