import { inject } from '@angular/core';
import { Principal } from '@core/components';
import { ensureSessionReady as ensureSessionReadyPipeline } from '@core/pipelines';
import {
  AUTH_SESSION_PORTS,
  TIMER_PORTS,
} from '@creativo/infrastructure/firebase-app';

/**
 * One `ensureSessionReady` run per guard invocation, wired to the same
 * `AUTH_SESSION_PORTS` / `TIMER_PORTS` singletons `app.config.ts` provides —
 * mirrors v2's `routerAuth.ensureReady()` (blueprint §1.4). A failed refresh
 * degrades to anonymous (fail closed: never let a broken token check grant
 * access).
 */
export async function ensureSessionReady(): Promise<Principal> {
  const run = ensureSessionReadyPipeline({
    ...inject(AUTH_SESSION_PORTS),
    ...inject(TIMER_PORTS),
  });
  const result = await run();
  return result.ok ? result.value : Principal.anonymous();
}
