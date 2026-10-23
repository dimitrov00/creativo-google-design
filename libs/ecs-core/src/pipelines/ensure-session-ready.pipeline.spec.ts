import { BehaviorSubject } from 'rxjs';
import { describe, expect, it } from 'vitest';
import type { Principal } from '@core/components';
import { PipelineError, PipelineErrorCode, Result } from '@core/primitives';
import { REFRESH_BACKOFF_MS } from '@core/systems';
import {
  immediateTimerPorts,
  memoryAuthSessionPorts,
  principalFixture,
} from '@core/testing';
import { ensureSessionReady } from './ensure-session-ready.pipeline';

/*
 * The cases of `EnsureSessionReadyUseCase`'s spec (the legacy identity
 * application lib, deleted in Phase 4b; ledger
 * `docs/architecture/flips/phase-4b-delete.md` §11.1), on a scripted principal
 * stream: each refresh unlocks the next principal of the script; the timer
 * records the back-off it was asked.
 */
function rig(script: readonly Principal[]) {
  const principals$ = new BehaviorSubject<Principal>(script[0] as Principal);
  let index = 0;
  let refreshes = 0;
  const delays: number[] = [];
  const run = ensureSessionReady({
    ...memoryAuthSessionPorts({
      principals$,
      refresh: () => {
        refreshes++;
        index = Math.min(index + 1, script.length - 1);
        principals$.next(script[index] as Principal);
        return Result.ok(undefined);
      },
    }),
    ...immediateTimerPorts(delays),
  });
  return { run, delays, refreshes: () => refreshes };
}

describe('ensureSessionReady — settle the session after sign-in', () => {
  it('returns immediately when already active — no refresh needed', async () => {
    const { run, refreshes, delays } = rig([principalFixture.client()]);
    expect(await run()).toEqual(Result.ok(principalFixture.client()));
    expect(refreshes()).toBe(0);
    expect(delays).toEqual([]);
  });

  it('retries refreshToken until the claim flips to active', async () => {
    const { run, refreshes } = rig([
      principalFixture.onboarding(),
      principalFixture.onboarding(),
      principalFixture.client(),
    ]);
    const settled = await run();
    expect(settled.ok && settled.value.principalKind).toBe('CLIENT');
    expect(refreshes()).toBe(2);
  });

  it('gives up after exhausting the fixed back-off schedule, still onboarding', async () => {
    const { run, refreshes, delays } = rig([principalFixture.onboarding()]);
    const settled = await run();
    expect(settled.ok && settled.value.principalKind).toBe('ONBOARDING');
    expect(refreshes()).toBe(REFRESH_BACKOFF_MS.length);
    expect(delays).toEqual(REFRESH_BACKOFF_MS.filter((ms) => ms > 0));
  });

  it('answers a refresh that fails with its failure', async () => {
    const failed = PipelineError.bare(PipelineErrorCode.Unavailable);
    const run = ensureSessionReady({
      ...memoryAuthSessionPorts({
        principals$: new BehaviorSubject<Principal>(
          principalFixture.onboarding(),
        ),
        refresh: () => Result.err(failed),
      }),
      ...immediateTimerPorts(),
    });
    expect(await run()).toEqual(Result.err(failed));
  });
});
