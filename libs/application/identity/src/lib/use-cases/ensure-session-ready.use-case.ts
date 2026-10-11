import { firstValueFrom } from 'rxjs';
import {
  REFRESH_BACKOFF_MS,
  SessionAccessSystem,
  SessionReadiness,
} from '@creativo/ecs-core';
import { Result, fail, ok } from '@creativo/domain/kernel';
import { Principal } from '@creativo/domain/identity';
import { principalTagOf } from '../flow/principal-tag';
import { AuthGateway, AuthGatewayError } from '../ports/auth-gateway.port';

/**
 * Ports v2's `routerAuth.ensureReady()` backoff verbatim (blueprint §1.4/§6).
 * Phase 2 shim (ECS migration): the schedule and the settle rule are
 * `SessionAccessSystem.readiness` (`@creativo/ecs-core`); this use case keeps
 * the timer, the token refresh and the observation.
 */
export const REFRESH_UNTIL_ACTIVE_BACKOFF_MS: readonly number[] =
  REFRESH_BACKOFF_MS;

export interface EnsureSessionReadyDeps {
  /** Injected so tests don't actually wait — defaults to a real `setTimeout`-backed delay. */
  readonly delay?: (ms: number) => Promise<void>;
}

function defaultDelay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Right after sign-in/registration, the just-minted custom claims can lag
 * a beat behind the ID token the client already holds — `Principal` reads
 * `onboarding` for a moment even though the account is really `active`.
 * Retries `AuthGateway.refreshToken()` on the fixed backoff schedule
 * until the observed `Principal` flips to `active`, or the schedule is
 * exhausted (the caller decides what an exhausted-but-still-onboarding
 * result means — never treated as an error here).
 */
export class EnsureSessionReadyUseCase {
  private readonly delay: (ms: number) => Promise<void>;

  constructor(
    private readonly authGateway: AuthGateway,
    deps: EnsureSessionReadyDeps = {},
  ) {
    this.delay = deps.delay ?? defaultDelay;
  }

  async execute(): Promise<Result<Principal, AuthGatewayError>> {
    let principal = await firstValueFrom(this.authGateway.observePrincipal());
    let refreshes = 0;
    let step = SessionAccessSystem.readiness(principalTagOf(principal), 0);
    while (step.sessionReadiness === SessionReadiness.Refresh) {
      if (step.delayMs > 0) {
        await this.delay(step.delayMs);
      }
      const refreshResult = await this.authGateway.refreshToken();
      if (refreshResult.isFailure()) {
        return fail(refreshResult.error);
      }
      refreshes++;
      principal = await firstValueFrom(this.authGateway.observePrincipal());
      step = SessionAccessSystem.readiness(
        principalTagOf(principal),
        refreshes,
      );
    }

    return ok(principal);
  }
}
