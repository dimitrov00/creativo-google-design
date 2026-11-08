import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import admin from 'firebase-admin';
import type { Firestore } from 'firebase-admin/firestore';
import {
  type AppliedDiscount,
  AnalyticsComparison,
  AnalyticsSpan,
  Combinability,
  DiscountMethod,
  DiscountSource,
  ExceptionEffectRule,
  MinuteRange,
  Role,
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
  UserId,
} from '@core/primitives';
import { AnalyticsErrorCode } from '@core/errors';
import { type Appointment, Collections } from '@core/entities';
import { ZonedTimeSystem } from '@core/systems';
import { type StaffAnalyticsCommand, staffAnalytics } from '@core/pipelines';
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
  registeredUserFixture,
  scheduleExceptionFixture,
  seatFixture,
  sequentialIds,
  termsFixture,
  unwrapErr,
  unwrapOk,
} from '@core/testing';
import { firestorePorts } from '../adapters/firestore-ports';
import { bodyOf } from '../adapters/store-answer';

/**
 * `staffAnalytics` against the REAL Firestore emulator, over the production
 * assembler (`firestorePorts` — the guarded analytics reads, the caller's
 * record, the rosters, the policy): a month for two barbers — rosters, a
 * visit with a discount, a no-show, a party, a follow-up and a block — and
 * one linked barber account. The barber reads their own report and is
 * refused a colleague's; the admin's shop report lists both barbers and its
 * takings are the sum of theirs; a period 13 months back is refused. The
 * emulator does not enforce composite indexes: this checks the query shapes
 * and their answers, not the `(barberId, localDate)` index.
 *
 * Emulator-only by construction, on a demo project of its own.
 */
const PROJECT_ID = 'demo-functions-staff-analytics';

const EMULATOR_HOST = (process.env['FIRESTORE_EMULATOR_HOST'] ??=
  '127.0.0.1:8080');
if (!EMULATOR_HOST.includes('127.0.0.1')) {
  throw new Error('Refusing to run outside the local emulators.');
}

/* The clock: Monday 28 September 2026, 09:00 in Sofia. The month: September. */
const IVAN = FIXTURE_IDS.barber;
const NIKO = BarberId.of('b-niko');
const CENTRE = FIXTURE_IDS.location;
const SEPTEMBER = localDate('2026-09-01');
const stamp = FIXTURE_NOW_UTC_MS;

const ADMIN = registeredUserFixture({
  id: UserId.of('u-admin'),
  roles: [Role.Admin],
});
const IVAN_USER = registeredUserFixture({
  id: UserId.of('u-ivan'),
  roles: [Role.Barber],
  linkedBarberId: IVAN,
});

let seatSeq = 0;
function seatOf(
  barberId: BarberId,
  priceCents: number,
  outcome: SeatOutcome = SeatOutcome.worked(stamp),
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
  appliedAtUtcMs: stamp,
  combinability: Combinability.Stackable,
  discountSource: DiscountSource.Manual,
  discountMethod: DiscountMethod.FixedAmount,
  discountAmountCents: 500,
  discountCurrency: Currency.EUR,
} as unknown as AppliedDiscount;

/** Ivan, Monday the 14th: 20,00 € less 5,00 € off. */
const DISCOUNTED = visitOn(
  'v-discounted',
  localDate('2026-09-14'),
  [seatOf(IVAN, 2000)],
  { discounts: [FIVE_OFF] },
);
/** A party on Tuesday the 15th: Ivan 25,00 €, Niko 30,00 €. */
const PARTY = visitOn('v-party', localDate('2026-09-15'), [
  seatOf(IVAN, 2500, SeatOutcome.worked(stamp), 11),
  seatOf(NIKO, 3000, SeatOutcome.worked(stamp), 11),
]);
/** Niko, Wednesday the 16th: the client never came. */
const NO_SHOW = visitOn('v-no-show', localDate('2026-09-16'), [
  seatOf(NIKO, 3000, SeatOutcome.noShow(stamp)),
]);
/** Booked from the discounted visit the same afternoon, for October. */
const FOLLOW_UP = visitOn(
  'v-follow-up',
  localDate('2026-10-12'),
  [seatOf(IVAN, 2000, SeatOutcome.scheduled())],
  {
    bookedFromAppointmentId: DISCOUNTED.id,
    bookedAtUtcMs: unwrapOk(
      ZonedTimeSystem.toUtc(
        localDate('2026-09-14'),
        minute(15 * 60),
        FIXTURE_TIME_ZONE,
      ),
    ),
  },
);
/** Ivan blocked 10:00–12:00 on Thursday the 17th. */
const BLOCK = scheduleExceptionFixture({
  id: ScheduleExceptionId.of(BusyKey.of(IVAN, localDate('2026-09-17'))),
  barberId: IVAN,
  localDate: localDate('2026-09-17'),
  utcEpochMs: ZonedTimeSystem.startOfLocalDay(
    localDate('2026-09-17'),
    FIXTURE_TIME_ZONE,
  ),
  ...unwrapOk(
    ExceptionEffectRule.blocked([MinuteRange.of(minute(600), endMinute(720))]),
  ),
});

describe('staffAnalytics (emulator)', () => {
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
      put(Collections.Users, ADMIN),
      put(Collections.Users, IVAN_USER),
      put(Collections.Appointments, DISCOUNTED),
      put(Collections.Appointments, PARTY),
      put(Collections.Appointments, NO_SHOW),
      put(Collections.Appointments, FOLLOW_UP),
      put(Collections.ScheduleExceptions, BLOCK),
    ]);
  });

  function report(cmd: StaffAnalyticsCommand) {
    const telemetry = recordingTelemetry();
    return staffAnalytics({
      ...firestorePorts(
        db,
        {
          nowUtcMs: pinnedNowUtcMs(stamp),
          nextId: sequentialIds('id'),
          hash: fixtureHash,
        },
        telemetry,
      ),
      ...telemetry,
      defaultLocationId: CENTRE,
    })(cmd);
  }

  const ask = (
    callerUserId: UserId,
    scopeBarberId: BarberId | null,
    fromLocalDate: LocalDate = SEPTEMBER,
  ): StaffAnalyticsCommand => ({
    callerUserId,
    scopeBarberId,
    fromLocalDate,
    analyticsSpan: AnalyticsSpan.Month,
    analyticsComparison: AnalyticsComparison.Previous,
  });

  it('answers the linked barber their own month — the discount split, the block, the rebooking', async () => {
    const own = unwrapOk(await report(ask(IVAN_USER.id, null)));
    expect(own.reportScopeBarberId).toBe(IVAN);
    // 15,00 € (20,00 € less 5,00 €) and their 25,00 € of the party.
    expect(own.reportTakingsCents).toBe(1500 + 2500);
    expect(own.reportBlockedMinutes).toBe(120);
    expect(own.reportRebookedBase).toBe(2);
    expect(own.reportRebookedCount).toBe(1);
    expect(own.reportSeatRows.map((row) => row.appointmentId).sort()).toEqual(
      [DISCOUNTED.id, PARTY.id].sort(),
    );
  });

  it('refuses the barber a colleague’s report', async () => {
    expect(unwrapErr(await report(ask(IVAN_USER.id, NIKO)))).toEqual({
      errorCode: AnalyticsErrorCode.Forbidden,
    });
  });

  it('answers the admin the shop: both barbers, the takings the sum of theirs, the party once', async () => {
    const shop = unwrapOk(await report(ask(ADMIN.id, null)));
    const ivan = unwrapOk(await report(ask(ADMIN.id, IVAN)));
    const niko = unwrapOk(await report(ask(ADMIN.id, NIKO)));
    expect(shop.reportBarbers.map((b) => b.barberId)).toEqual([IVAN, NIKO]);
    expect(shop.reportTakingsCents).toBe(
      ivan.reportTakingsCents + niko.reportTakingsCents,
    );
    expect(shop.reportTakingsCents).toBe(1500 + 2500 + 3000);
    expect(shop.reportBarbers.reduce((sum, b) => sum + b.takingsCents, 0)).toBe(
      shop.reportTakingsCents,
    );
    expect(niko.reportNoShowCount).toBe(1);
    expect(shop.reportRebookedCount).toBe(1);
  });

  it('refuses a period 13 months back', async () => {
    const from = localDate('2025-08-01');
    expect(unwrapErr(await report(ask(ADMIN.id, null, from)))).toEqual({
      errorCode: AnalyticsErrorCode.PeriodOutOfRange,
      fromLocalDate: from,
    });
  });
});
