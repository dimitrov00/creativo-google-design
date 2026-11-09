import { describe, expect, it } from 'vitest';
import {
  type AnalyticsCall,
  AnalyticsComparison,
  AnalyticsSpan,
  type SetAnalyticsGoalCall,
} from '@core/components';
import { PipelineError, PipelineErrorCode } from '@core/errors';
import { Callables } from '@core/ports';
import {
  BarberId,
  LocalDate,
  MonthKey,
  type PriceCents,
  Result,
} from '@core/primitives';
import {
  FIXTURE_NOW_UTC_MS,
  type GatewayCall,
  analyticsReportFixture,
  goalSetAnswerOf,
  deepFreeze,
  scriptedGatewayPorts,
  unwrapErr,
  unwrapOk,
} from '@core/testing';
import { analyticsCallPorts } from './analytics-call.adapter';

/** The store's request: Ivan's own September (a barber sends no scope). */
const CALL: AnalyticsCall = {
  scopeBarberId: null,
  scopeLocationId: null,
  fromLocalDate: unwrapOk(LocalDate.parse('2026-09-01')),
  toLocalDate: null,
  analyticsSpan: AnalyticsSpan.Month,
  analyticsComparison: AnalyticsComparison.Previous,
};

describe('analyticsCallPorts (staff analytics, the screen)', () => {
  it('requestReport dials staffAnalytics with the call as built, answering the decoded report', async () => {
    const calls: GatewayCall[] = [];
    const report = analyticsReportFixture();
    const ports = analyticsCallPorts(
      scriptedGatewayPorts(
        { [Callables.StaffAnalytics]: () => Result.ok(report) },
        calls,
      ),
    );
    const call = deepFreeze({ ...CALL });

    const answer = await ports.requestReport(call);

    expect(unwrapOk(answer)).toBe(report);
    expect(calls).toEqual([
      { callable: Callables.StaffAnalytics, input: CALL },
    ]);
    expect(calls[0]?.input).toBe(call);
  });

  it('sends an admin’s chosen barber as the scope', async () => {
    const calls: GatewayCall[] = [];
    const ports = analyticsCallPorts(
      scriptedGatewayPorts(
        {
          [Callables.StaffAnalytics]: () => Result.ok(analyticsReportFixture()),
        },
        calls,
      ),
    );
    await ports.requestReport({ ...CALL, scopeBarberId: BarberId.of('niko') });
    expect(calls[0]?.input).toEqual({
      ...CALL,
      scopeBarberId: BarberId.of('niko'),
    });
  });

  it('hands a refusal on as the one PipelineError, its analytics code kept', async () => {
    const refused = PipelineError.fromWire('functions/failed-precondition', {
      errorCode: 'ANALYTICS_BARBER_NOT_LINKED',
    });
    const ports = analyticsCallPorts(
      scriptedGatewayPorts({
        [Callables.StaffAnalytics]: () => Result.err(refused),
      }),
    );

    const error = unwrapErr(await ports.requestReport(CALL));

    expect(error).toBe(refused);
    expect(error.serverErrorCode).toBe('ANALYTICS_BARBER_NOT_LINKED');
  });

  it('answers PIPELINE_UNKNOWN when the client cannot reach the callable', async () => {
    const ports = analyticsCallPorts(scriptedGatewayPorts());
    expect(unwrapErr(await ports.requestReport(CALL)).errorCode).toBe(
      PipelineErrorCode.Unknown,
    );
  });

  describe('setAnalyticsGoal (v2 PR 6)', () => {
    /** The sheet's call: Ivan's own November, 1 800–2 200 €. */
    const GOAL: SetAnalyticsGoalCall = {
      scopeBarberId: null,
      goalMonth: MonthKey.of('2026-11'),
      goalLowCents: 180_000 as PriceCents,
      goalHighCents: 220_000 as PriceCents,
    };

    it('dials setAnalyticsGoal with the call as built, answering the decoded key and stamp', async () => {
      const calls: GatewayCall[] = [];
      const answer = goalSetAnswerOf(
        { ...GOAL, scopeBarberId: BarberId.of('ivan') },
        FIXTURE_NOW_UTC_MS,
      );
      const ports = analyticsCallPorts(
        scriptedGatewayPorts(
          { [Callables.SetAnalyticsGoal]: () => Result.ok(answer) },
          calls,
        ),
      );
      const call = deepFreeze({ ...GOAL });

      expect(unwrapOk(await ports.setAnalyticsGoal(call))).toBe(answer);
      expect(calls).toEqual([
        { callable: Callables.SetAnalyticsGoal, input: GOAL },
      ]);
      expect(calls[0]?.input).toBe(call);
      expect(answer.goalKey).toBe('ivan__2026-11');
    });

    it('hands a goal refusal on as the one PipelineError, its analytics code kept', async () => {
      const refused = PipelineError.fromWire('functions/invalid-argument', {
        errorCode: 'ANALYTICS_GOAL_INVALID_RANGE',
        field: 'goalMonth',
      });
      const ports = analyticsCallPorts(
        scriptedGatewayPorts({
          [Callables.SetAnalyticsGoal]: () => Result.err(refused),
        }),
      );
      const error = unwrapErr(await ports.setAnalyticsGoal(GOAL));
      expect(error).toBe(refused);
      expect(error.serverErrorCode).toBe('ANALYTICS_GOAL_INVALID_RANGE');
    });
  });
});
