import { describe, expect, it } from 'vitest';
import {
  type AnalyticsCall,
  AnalyticsComparison,
  AnalyticsSpan,
} from '@core/components';
import { PipelineError, PipelineErrorCode } from '@core/errors';
import { Callables } from '@core/ports';
import { BarberId, LocalDate, Result } from '@core/primitives';
import {
  type GatewayCall,
  analyticsReportFixture,
  deepFreeze,
  scriptedGatewayPorts,
  unwrapErr,
  unwrapOk,
} from '@core/testing';
import { analyticsCallPorts } from './analytics-call.adapter';

/** The store's request: Ivan's own September (a barber sends no scope). */
const CALL: AnalyticsCall = {
  scopeBarberId: null,
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
});
