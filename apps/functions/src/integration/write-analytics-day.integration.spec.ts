import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import admin from 'firebase-admin';
import type { Firestore } from 'firebase-admin/firestore';
import {
  ANALYTICS_DEFINITION_VERSION,
  type AppliedDiscount,
  BookingLifecycle,
  CancellationReason,
  CancellationReasonSet,
  CancelledBy,
  Combinability,
  DayFigures,
  DiscountMethod,
  DiscountSource,
  ExceptionEffectRule,
  MinuteRange,
  Seat,
  SeatOutcome,
} from '@core/components';
import {
  AppliedDiscountId,
  AppointmentId,
  BarberId,
  BusyKey,
  Currency,
  type LocalDate,
  ScheduleExceptionId,
  SeatId,
  UtcEpochMs,
} from '@core/primitives';
import { type Appointment, Collections } from '@core/entities';
import { ZonedTimeSystem } from '@core/systems';
import {
  AnalyticsDaySource,
  type WriteAnalyticsDayCommand,
  writeAnalyticsDay,
} from '@core/pipelines';
import {
  FIXTURE_IDS,
  FIXTURE_NOW_UTC_MS,
  FIXTURE_TIME_ZONE,
  appointmentFixture,
  barberFixture,
  barberScheduleFixture,
  endMinute,
  fixtureHash,
  localDate,
  locationFixture,
  minute,
  pinnedNowUtcMs,
  recordingTelemetry,
  scheduleExceptionFixture,
  seatFixture,
  sequentialIds,
  termsFixture,
  unwrapOk,
} from '@core/testing';
import { firestorePorts } from '../adapters/firestore-ports';
import { bodyOf } from '../adapters/store-answer';
import {
  decodeAnalyticsDayEvent,
  decodeRebuildBusyEvent,
} from '../wire/triggers.wire';

/**
 * The day writer against the REAL Firestore emulator (staff analytics v2,
 * PR 4a), over the production assembler (`firestorePorts`: the guarded
 * reads, the commit plan that stamps `purgeAt`) and the triggers' decoders:
 * an appointment write, decoded as the appointment trigger decodes it, writes
 * the past day's document and skips a live day; a departure write rewrites
 * its day; a cancelled follow-up rewrites the source visit's day; and the
 * stamp rule holds against the store — an older read never overwrites a
 * newer document. The transaction's `array-contains` and `in` queries and
 * the TTL stamp are exactly what a fake would flatter. The flag
 * `analytics.storedDays` is not read by the write path (PR 4b reads it).
 *
 * Emulator-only by construction, on a demo project of its own.
 */
const PROJECT_ID = 'demo-functions-analytics-days';

const EMULATOR_HOST = (process.env['FIRESTORE_EMULATOR_HOST'] ??=
  '127.0.0.1:8080');
if (!EMULATOR_HOST.includes('127.0.0.1')) {
  throw new Error('Refusing to run outside the local emulators.');
}

/* The clock: Monday 28 September 2026, 09:00 in Sofia. */
const IVAN = FIXTURE_IDS.barber;
const NIKO = BarberId.of('b-niko');
const CENTRE = FIXTURE_IDS.location;
const NOW = FIXTURE_NOW_UTC_MS;
const MINUTE = 60_000;
const SEPT_14 = localDate('2026-09-14');
const SEPT_17 = localDate('2026-09-17');
const TODAY = localDate('2026-09-28');
const SOLO_KEY = BusyKey.of(IVAN, SEPT_14);

let seatSeq = 0;
function seatOf(
  barberId: BarberId,
  priceCents: number,
  outcome: SeatOutcome = SeatOutcome.worked(NOW),
  hour = 10,
): Seat {
  return seatFixture({
    seatId: SeatId.of(`s-${++seatSeq}`),
    barberId,
    startMinutes: minute(hour * 60),
    terms: Seat.termsOf(termsFixture(priceCents, 30, 0, 0), null),
    outcome,
  });
}

function visitOn(
  id: string,
  day: LocalDate,
  seats: readonly Seat[],
  extra: Partial<Appointment> = {},
): Appointment {
  const barbers = [...new Set(seats.map((seat) => seat.barberId))];
  const first = seats[0] as Seat;
  return appointmentFixture({
    id: AppointmentId.of(id),
    localDate: day,
    startMinutes: first.startMinutes,
    endMinutes: Seat.endMinutes(first),
    utcEpochMs: unwrapOk(
      ZonedTimeSystem.toUtc(day, first.startMinutes, FIXTURE_TIME_ZONE),
    ),
    seats,
    barberIds: barbers,
    busyKeys: barbers.map((barber) => BusyKey.of(barber, day)),
    ...extra,
  });
}

/** 5,00 € off the bill at the counter. */
const FIVE_OFF = {
  discountId: AppliedDiscountId.of('manual'),
  label: 'Counter',
  appliedAtUtcMs: NOW,
  combinability: Combinability.Stackable,
  discountSource: DiscountSource.Manual,
  discountMethod: DiscountMethod.FixedAmount,
  discountAmountCents: 500,
  discountCurrency: Currency.EUR,
} as unknown as AppliedDiscount;

/** Ivan, Monday the 14th: 20,00 € less 5,00 € off, worked. */
const DISCOUNTED = visitOn('v-discounted', SEPT_14, [seatOf(IVAN, 2000)], {
  discounts: [FIVE_OFF],
});
/** Ivan, today at 10:00 — a live day. */
const LIVE = visitOn('v-live', TODAY, [
  seatOf(IVAN, 2800, SeatOutcome.scheduled()),
]);
/** Booked from the discounted visit the same afternoon, for October. */
const FOLLOW_UP = visitOn(
  'v-follow-up',
  localDate('2026-10-12'),
  [seatOf(IVAN, 2000, SeatOutcome.scheduled())],
  {
    bookedFromAppointmentId: DISCOUNTED.id,
    bookedAtUtcMs: unwrapOk(
      ZonedTimeSystem.toUtc(SEPT_14, minute(15 * 60), FIXTURE_TIME_ZONE),
    ),
  },
);
/** The follow-up, called off by the client. */
const CANCELLED_AT = UtcEpochMs.plusMs(NOW, -3 * 86_400_000);
const CANCELLED_FOLLOW_UP: Appointment = {
  ...FOLLOW_UP,
  seats: [
    {
      ...(FOLLOW_UP.seats[0] as Seat),
      ...SeatOutcome.cancelled(
        CANCELLED_AT,
        CancelledBy.Client,
        CancellationReason.ClientChangedPlans,
        null,
      ),
    },
  ],
  ...BookingLifecycle.cancel(
    CANCELLED_AT,
    CancellationReasonSet.of([CancellationReason.ClientChangedPlans]),
  ),
};
/** Ivan blocked 10:00–12:00 on Thursday the 17th. */
const BLOCK = scheduleExceptionFixture({
  id: ScheduleExceptionId.of(BusyKey.of(IVAN, SEPT_17)),
  barberId: IVAN,
  localDate: SEPT_17,
  utcEpochMs: ZonedTimeSystem.startOfLocalDay(SEPT_17, FIXTURE_TIME_ZONE),
  ...unwrapOk(
    ExceptionEffectRule.blocked([MinuteRange.of(minute(600), endMinute(720))]),
  ),
});

const side = (body: Record<string, unknown> | null) => ({
  exists: body !== null,
  data: () => body ?? undefined,
});

/** An appointment write as the trigger delivers it, decoded as `rebuildBusyOnAppointmentChange` decodes it. */
function appointmentCommand(
  before: Appointment | null,
  after: Appointment | null,
): WriteAnalyticsDayCommand {
  const id = (after ?? before)?.id ?? 'none';
  return {
    analyticsDaySource: AnalyticsDaySource.Appointment,
    ...decodeRebuildBusyEvent({
      id: `evt-${id}`,
      time: '2026-09-28T06:00:00.000000Z',
      params: { appointmentId: id },
      data: {
        before: side(before === null ? null : bodyOf(before)),
        after: side(after === null ? null : bodyOf(after)),
      },
    }),
  };
}

describe('writeAnalyticsDay (emulator)', () => {
  let db: Firestore;

  beforeAll(() => {
    const app =
      admin.apps.find((a) => a?.name === PROJECT_ID) ??
      admin.initializeApp({ projectId: PROJECT_ID }, PROJECT_ID);
    db = app.firestore();
  });

  afterAll(async () => {
    await Promise.all(admin.apps.map((app) => app?.delete()));
  });

  beforeEach(async () => {
    await fetch(
      `http://${EMULATOR_HOST}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`,
      { method: 'DELETE' },
    );
    const put = (collection: string, entity: { readonly id: string }) =>
      db.collection(collection).doc(entity.id).set(bodyOf(entity));
    await Promise.all([
      put(Collections.Locations, locationFixture()),
      put(Collections.Barbers, barberFixture({ id: IVAN })),
      put(Collections.Barbers, barberFixture({ id: NIKO })),
      put(Collections.BarberSchedules, barberScheduleFixture({ id: IVAN })),
      put(Collections.BarberSchedules, barberScheduleFixture({ id: NIKO })),
      put(Collections.Appointments, DISCOUNTED),
      put(Collections.Appointments, LIVE),
      put(Collections.Appointments, FOLLOW_UP),
      put(Collections.ScheduleExceptions, BLOCK),
    ]);
  });

  function writer(nowUtcMs = NOW) {
    const telemetry = recordingTelemetry();
    return writeAnalyticsDay({
      ...firestorePorts(
        db,
        {
          nowUtcMs: pinnedNowUtcMs(nowUtcMs),
          nextId: sequentialIds('id'),
          hash: fixtureHash,
        },
        telemetry,
      ),
      ...telemetry,
      defaultLocationId: CENTRE,
    });
  }

  async function dayAt(key: BusyKey) {
    return (
      await db.collection(Collections.AnalyticsDays).doc(key).get()
    ).data();
  }

  it('the appointment trigger writes a past day’s document — the fold, the version, the stamp, the TTL — and skips a live day', async () => {
    const answer = await writer()(appointmentCommand(null, DISCOUNTED));
    expect(answer).toMatchObject({
      ok: true,
      value: { writtenKeys: [SOLO_KEY], skippedKeys: [], failures: [] },
    });
    const day = await dayAt(SOLO_KEY);
    expect(day).toMatchObject({
      barberId: IVAN,
      localDate: SEPT_14,
      // 09:00–18:00 rostered; one 30-minute seat worked.
      dayRosteredMinutes: 540,
      dayWorkedMinutes: 30,
      // 20,00 € less 5,00 € off.
      dayTakingsCents: 1500,
      currency: Currency.EUR,
      dayWorkedSeatCount: 1,
      // Rebooked the same afternoon — final on a past day.
      dayRebookedBase: 1,
      dayRebookedCount: 1,
      dayDefinitionVersion: ANALYTICS_DEFINITION_VERSION,
      dayComputedAtUtcMs: NOW,
    });
    expect(day?.['purgeAt']).toBeDefined();
    const { purgeAt: _purgeAt, ...body } = day as Record<string, unknown>;
    expect(DayFigures.is(body)).toBe(true);

    const live = await writer()(appointmentCommand(null, LIVE));
    expect(live).toMatchObject({
      ok: true,
      value: { writtenKeys: [], skippedKeys: [BusyKey.of(IVAN, TODAY)] },
    });
    expect(await dayAt(BusyKey.of(IVAN, TODAY))).toBeUndefined();
  });

  it('the departure trigger rewrites its day — the block’s minutes land on the stored day', async () => {
    const cmd = decodeAnalyticsDayEvent({
      id: 'evt-block',
      time: '2026-09-28T06:00:00.000000Z',
      params: { docId: BLOCK.id },
      data: { before: side(null), after: side(bodyOf(BLOCK)) },
    });
    expect(cmd).toEqual({
      analyticsDaySource: AnalyticsDaySource.Departure,
      keys: [BusyKey.of(IVAN, SEPT_17)],
    });
    const answer = await writer()(cmd as WriteAnalyticsDayCommand);
    expect(answer).toMatchObject({
      ok: true,
      value: { writtenKeys: [BusyKey.of(IVAN, SEPT_17)] },
    });
    expect(await dayAt(BusyKey.of(IVAN, SEPT_17))).toMatchObject({
      dayRosteredMinutes: 540,
      dayBlockedMinutes: 120,
      dayWorkedMinutes: 0,
      dayWorkedSeatCount: 0,
    });
  });

  it('a cancelled follow-up rewrites the source visit’s day without its rebooking', async () => {
    await writer()(appointmentCommand(null, DISCOUNTED));
    expect(await dayAt(SOLO_KEY)).toMatchObject({ dayRebookedCount: 1 });

    await db
      .collection(Collections.Appointments)
      .doc(FOLLOW_UP.id)
      .set(bodyOf(CANCELLED_FOLLOW_UP));
    const later = UtcEpochMs.plusMs(NOW, MINUTE);
    const answer = await writer(later)(
      appointmentCommand(FOLLOW_UP, CANCELLED_FOLLOW_UP),
    );
    expect(answer).toMatchObject({
      ok: true,
      value: {
        writtenKeys: [SOLO_KEY],
        skippedKeys: [BusyKey.of(IVAN, localDate('2026-10-12'))],
      },
    });
    expect(await dayAt(SOLO_KEY)).toMatchObject({
      dayRebookedBase: 1,
      dayRebookedCount: 0,
      dayComputedAtUtcMs: later,
    });
  });

  it('stamp ordering holds against the store: a writer that read earlier never overwrites a newer document', async () => {
    const later = UtcEpochMs.plusMs(NOW, MINUTE);
    await writer(later)(appointmentCommand(null, DISCOUNTED));
    const written = await dayAt(SOLO_KEY);
    expect(written).toMatchObject({ dayComputedAtUtcMs: later });

    const answer = await writer(NOW)(appointmentCommand(null, DISCOUNTED));
    expect(answer).toMatchObject({
      ok: true,
      value: { writtenKeys: [], keptKeys: [SOLO_KEY] },
    });
    expect(await dayAt(SOLO_KEY)).toEqual(written);
  });
});
