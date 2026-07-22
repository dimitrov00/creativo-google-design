import { firstValueFrom } from 'rxjs';
import { Result, fail, ok } from '@creativo/domain/kernel';
import { Principal } from '@creativo/domain/identity';
import { AuthGateway, AuthGatewayError } from '../ports/auth-gateway.port';

/** Ports v2's `routerAuth.ensureReady()` backoff verbatim (blueprint §1.4/§6). */
export const REFRESH_UNTIL_ACTIVE_BACKOFF_MS: readonly number[] = [
  0, 200, 400, 700, 1200, 1600,
];

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
    if (principal.kind !== 'onboarding') {
      return ok(principal);
    }

    for (const delayMs of REFRESH_UNTIL_ACTIVE_BACKOFF_MS) {
      if (delayMs > 0) {
        await this.delay(delayMs);
      }
      const refreshResult = await this.authGateway.refreshToken();
      if (refreshResult.isFailure()) {
        return fail(refreshResult.error);
      }
      principal = await firstValueFrom(this.authGateway.observePrincipal());
      if (principal.kind === 'active') {
        return ok(principal);
      }
    }

    return ok(principal);
  }
}
