import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { describe, expect, it, vi } from 'vitest';
import { type GovernanceCall, ImpersonationScope } from '@core/components';
import { PipelineError, PipelineErrorCode } from '@core/errors';
import type { ReadAsCallPorts } from '@core/ports';
import {
  ImpersonationSessionId,
  Result,
  UserId,
  UtcEpochMs,
} from '@core/primitives';
import { memoryClockPorts, unwrapOk } from '@core/testing';
import {
  CLOCK_PORTS,
  READ_AS_CALL_PORTS,
  READ_AS_SESSION_PORTS,
} from '@creativo/infrastructure/firebase-app';
import { ReadAsStartStore } from './read-as-start.store';

/*
 * Starting a support read-as (OR-24): opened on the server with the reason,
 * the browser's session swapped for the token, then the target's home — a
 * refusal kept for the sheet to word.
 */

const NOW = unwrapOk(UtcEpochMs.of(Date.UTC(2026, 10, 24, 10, 0)));
const TARGET = UserId.of('u-owner');

function harness(
  started: Result<GovernanceCall.Started, PipelineError> = Result.ok({
    sessionId: ImpersonationSessionId.of('imp-1'),
    customToken: 'read-as-token',
  }),
  signed: Result<void, PipelineError> = Result.ok(undefined),
) {
  const asked: GovernanceCall[] = [];
  const tokens: string[] = [];
  const calls: ReadAsCallPorts = {
    startReadAs: async (call) => {
      asked.push(call);
      return started;
    },
    endReadAs: async () =>
      Result.err(PipelineError.bare(PipelineErrorCode.Unknown)),
  };
  TestBed.configureTestingModule({
    providers: [
      ReadAsStartStore,
      provideRouter([]),
      { provide: CLOCK_PORTS, useValue: memoryClockPorts(NOW) },
      { provide: READ_AS_CALL_PORTS, useValue: calls },
      {
        provide: READ_AS_SESSION_PORTS,
        useValue: {
          signInWithReadAsToken: async (token: string) => {
            tokens.push(token);
            return signed;
          },
        },
      },
    ],
  });
  const navigate = vi
    .spyOn(TestBed.inject(Router), 'navigateByUrl')
    .mockResolvedValue(true);
  return { store: TestBed.inject(ReadAsStartStore), asked, tokens, navigate };
}

describe('ReadAsStartStore', () => {
  it('opens a READ session a minute under the cap, signs in with its token, and opens the target’s home', async () => {
    const { store, asked, tokens, navigate } = harness();
    await store.start(TARGET, 'support ticket 42');
    expect(asked).toEqual([
      {
        targetUserId: TARGET,
        impersonationScope: ImpersonationScope.Read,
        reason: 'support ticket 42',
        expiresAtUtcMs: UtcEpochMs.plusMs(NOW, 14 * 60_000),
      },
    ]);
    expect(tokens).toEqual(['read-as-token']);
    expect(navigate).toHaveBeenCalledWith('/account');
    expect(store.refusal()).toBeNull();
  });

  it('keeps a refused start for the sheet, and signs in with nothing', async () => {
    const refused = PipelineError.bare(PipelineErrorCode.Unknown);
    const { store, tokens, navigate } = harness(Result.err(refused));
    await store.start(TARGET, 'why');
    expect(store.refusal()).toEqual(refused);
    expect(store.pending()).toBe(false);
    expect(tokens).toEqual([]);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('keeps a failed sign-in for the sheet, and stays where it is', async () => {
    const failed = PipelineError.bare(PipelineErrorCode.Unavailable);
    const { store, navigate } = harness(undefined, Result.err(failed));
    await store.start(TARGET, 'why');
    expect(store.refusal()).toEqual(failed);
    expect(navigate).not.toHaveBeenCalled();
  });
});
