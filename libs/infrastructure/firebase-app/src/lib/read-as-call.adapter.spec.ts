import { describe, expect, it } from 'vitest';
import {
  type GovernanceCall,
  ImpersonationEndReason,
  ImpersonationScope,
} from '@core/components';
import { PipelineError } from '@core/errors';
import { Callables } from '@core/ports';
import {
  ImpersonationSessionId,
  Result,
  UserId,
  UtcEpochMs,
} from '@core/primitives';
import {
  FIXTURE_NOW_UTC_MS,
  type GatewayCall,
  scriptedGatewayPorts,
  unwrapErr,
  unwrapOk,
} from '@core/testing';
import { readAsCallPorts } from './read-as-call.adapter';

/** Support's start: whom, why, until when (OR-24). */
const START: GovernanceCall = {
  targetUserId: UserId.of('u-owner'),
  impersonationScope: ImpersonationScope.Read,
  reason: 'support ticket 42',
  expiresAtUtcMs: UtcEpochMs.plusMs(FIXTURE_NOW_UTC_MS, 14 * 60_000),
};
const SESSION = ImpersonationSessionId.of('imp-1');

describe('readAsCallPorts (OR-24)', () => {
  it('dials startImpersonation and endImpersonation with the calls as built, answering the server’s answers', async () => {
    const calls: GatewayCall[] = [];
    const started: GovernanceCall.Started = {
      sessionId: SESSION,
      customToken: 'read-as-token',
    };
    const ended: GovernanceCall.Ended = {
      sessionId: SESSION,
      impersonationEndReason: ImpersonationEndReason.AdminEnded,
    };
    const ports = readAsCallPorts(
      scriptedGatewayPorts(
        {
          [Callables.StartImpersonation]: () => Result.ok(started),
          [Callables.EndImpersonation]: () => Result.ok(ended),
        },
        calls,
      ),
    );

    expect(unwrapOk(await ports.startReadAs(START))).toBe(started);
    expect(unwrapOk(await ports.endReadAs({ sessionId: SESSION }))).toBe(ended);
    expect(calls).toEqual([
      { callable: Callables.StartImpersonation, input: START },
      { callable: Callables.EndImpersonation, input: { sessionId: SESSION } },
    ]);
  });

  it('hands a refusal on as the one PipelineError, unchanged', async () => {
    const refused = PipelineError.fromWire('functions/permission-denied', {
      errorCode: 'GOVERNANCE_IMPERSONATION_FORBIDDEN',
    });
    const ports = readAsCallPorts(
      scriptedGatewayPorts({
        [Callables.StartImpersonation]: () => Result.err(refused),
      }),
    );
    expect(unwrapErr(await ports.startReadAs(START))).toBe(refused);
  });
});
