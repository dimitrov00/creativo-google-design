import { firstValueFrom } from 'rxjs';
import type { Principal } from '@core/components';
import { type PipelineError, Result } from '@core/primitives';
import type { AuthSessionPorts, TimerPorts } from '@core/ports';
import { SessionAccessSystem, SessionReadiness } from '@core/systems';

export type EnsureSessionReadyPorts = AuthSessionPorts & TimerPorts;

/**
 * SETTLE THE SESSION after sign-in or registration (Phase 4a 4A-8; the
 * legacy `EnsureSessionReadyUseCase` verbatim): the just-minted custom
 * claims can lag a beat behind the ID token the client already holds, so
 * the principal reads `ONBOARDING` for a moment even though the account is
 * active. Refreshes the token on the fixed back-off schedule
 * (`SessionAccessSystem.readiness` over `REFRESH_BACKOFF_MS`) until the
 * observed principal is active, or the schedule is exhausted — answered as
 * it stands then (the caller decides what a still-onboarding principal
 * means; never an error here). A failed refresh is the one failure.
 */
export const ensureSessionReady =
  (ports: EnsureSessionReadyPorts) =>
  async (): Promise<Result<Principal, PipelineError>> => {
    let principal = await firstValueFrom(ports.observePrincipal());
    let refreshes = 0;
    let step = SessionAccessSystem.readiness(principal, 0);
    while (step.sessionReadiness === SessionReadiness.Refresh) {
      if (step.delayMs > 0) await ports.delay(step.delayMs);
      const refreshed = await ports.refreshToken();
      if (!refreshed.ok) return refreshed;
      refreshes++;
      principal = await firstValueFrom(ports.observePrincipal());
      step = SessionAccessSystem.readiness(principal, refreshes);
    }
    return Result.ok(principal);
  };
