import { describe, expect, it } from 'vitest';
import {
  AnalyticsGoalKey,
  BarberId,
  BusyKey,
  Currency,
  LocalDate,
  MonthKey,
  type PriceCents,
  UserId,
} from '@core/primitives';
import { appointmentFixture } from './appointment.fixtures';
import {
  goalSetAnswerOf,
  memoryAnalyticsGoalPorts,
  memoryAnalyticsReadPorts,
  scriptedAnalyticsCallPorts,
} from './analytics-doubles';
import { FIXTURE_NOW_UTC_MS } from './test-support';
import { PipelineErrorCode } from '@core/errors';
import { Result } from '@core/primitives';
import { localDate, unwrapOk } from './test-support';

describe('memoryAnalyticsReadPorts — answers as the Firestore adapter does', () => {
  it('splits keys into queries of 30 and concatenates their rows, a visit of two chunks twice', async () => {
    const ivan = BarberId.of('ivan');
    const niko = BarberId.of('niko');
    const day = localDate('2026-09-15');
    const party = appointmentFixture({
      localDate: day,
      busyKeys: [BusyKey.of(ivan, day), BusyKey.of(niko, day)],
    });
    const { ports, log } = memoryAnalyticsReadPorts({ visits: [party] });
    const days = LocalDate.range(
      localDate('2026-09-01'),
      localDate('2026-09-30'),
    );
    const keys = [
      ...days.map((d) => BusyKey.of(ivan, d)),
      ...days.map((d) => BusyKey.of(niko, d)),
    ];
    const rows = unwrapOk(await ports.loadVisitsByBusyKeys(keys));
    expect(log.visitQueries.map((chunk) => chunk.length)).toEqual([30, 30]);
    expect(rows).toEqual([party, party]);
  });
});

describe('the goal doubles (v2 PR 6)', () => {
  const month = MonthKey.of('2026-11');
  const ivan = BarberId.of('ivan');
  const goal = {
    id: AnalyticsGoalKey.of(ivan, month),
    barberId: ivan,
    goalMonth: month,
    goalLowCents: 180_000 as PriceCents,
    goalHighCents: 220_000 as PriceCents,
    currency: Currency.EUR,
    goalSetByUserId: UserId.of('u-ivan'),
    goalSetAtUtcMs: FIXTURE_NOW_UTC_MS,
  };

  it('memoryAnalyticsGoalPorts answers the goal by key, null for another, and logs every read', async () => {
    const { ports, log } = memoryAnalyticsGoalPorts([goal]);
    expect(unwrapOk(await ports.loadAnalyticsGoal(goal.id))).toBe(goal);
    const shop = AnalyticsGoalKey.of(null, month);
    expect(unwrapOk(await ports.loadAnalyticsGoal(shop))).toBeNull();
    expect(log.keyReads).toEqual([goal.id, shop]);
  });

  it('scriptedAnalyticsCallPorts answers the script and records each call; an unscripted callable answers PIPELINE_UNKNOWN', async () => {
    const call = {
      scopeBarberId: ivan,
      goalMonth: month,
      goalLowCents: 180_000 as PriceCents,
      goalHighCents: 220_000 as PriceCents,
    };
    const { ports, log } = scriptedAnalyticsCallPorts({
      goal: (sent) => Result.ok(goalSetAnswerOf(sent, FIXTURE_NOW_UTC_MS)),
    });
    expect(unwrapOk(await ports.setAnalyticsGoal(call))).toEqual({
      goalKey: 'ivan__2026-11',
      goalSetAtUtcMs: FIXTURE_NOW_UTC_MS,
    });
    expect(log.goals).toEqual([call]);
    const report = await ports.requestReport({
      scopeBarberId: null,
      scopeLocationId: null,
      fromLocalDate: localDate('2026-11-01'),
      toLocalDate: null,
      analyticsSpan: 'MONTH',
      analyticsComparison: 'PREVIOUS',
    });
    expect(!report.ok && report.error.errorCode).toBe(
      PipelineErrorCode.Unknown,
    );
    expect(log.reports).toHaveLength(1);
  });
});
