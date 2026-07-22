import { inject } from '@angular/core';
import {
  AUTH_GATEWAY,
  EnsureSessionReadyUseCase,
} from '@creativo/application/identity';
import { ANONYMOUS_PRINCIPAL, Principal } from '@creativo/domain/identity';

/**
 * One `EnsureSessionReadyUseCase` per guard invocation, wired to the same
 * `AUTH_GATEWAY` singleton `app.config.ts` provides — mirrors v2's
 * `routerAuth.ensureReady()` (blueprint §1.4). A failed refresh degrades to
 * `anonymous` (fail closed: never let a broken token check grant access).
 */
export async function ensureSessionReady(): Promise<Principal> {
  const authGateway = inject(AUTH_GATEWAY);
  const useCase = new EnsureSessionReadyUseCase(authGateway);
  const result = await useCase.execute();
  return result.isSuccess() ? result.value : ANONYMOUS_PRINCIPAL;
}
