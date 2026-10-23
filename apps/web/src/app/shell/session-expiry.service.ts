import { Injectable, effect, inject } from '@angular/core';
import { Router } from '@angular/router';
import { PrincipalKind } from '@core/components';
import { PipelineErrorCode } from '@core/errors';
import { AccountStateService } from '@creativo/features/client/account-state';
import { AUTH_SESSION_PORTS } from '@creativo/infrastructure/firebase-app';

const CHECK_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Mirrors v2's `SessionExpiryGuard` (`src/lib/auth/session-expiry.ts`) at a
 * reduced fidelity: v2 enforces a long-lived `sessionExpiry` custom claim
 * distinct from routine ID-token refresh; `AuthClaims`/`Principal` in this
 * codebase carry no such field yet. Until that claim exists, this polls
 * `refreshToken()` while signed in and treats a session that is gone as
 * the session having gone bad — catching the same class of "stale session
 * sitting on a page" problem the guard exists for, via the one signal
 * already available.
 */
@Injectable({ providedIn: 'root' })
export class SessionExpiryService {
  private readonly session = inject(AUTH_SESSION_PORTS);
  private readonly account = inject(AccountStateService);
  private readonly router = inject(Router);

  constructor() {
    effect((onCleanup) => {
      if (this.account.principal().principalKind === PrincipalKind.Anonymous) {
        return;
      }

      const id = setInterval(() => void this.checkSession(), CHECK_INTERVAL_MS);
      onCleanup(() => clearInterval(id));
    });
  }

  private async checkSession(): Promise<void> {
    const result = await this.session.refreshToken();
    if (result.ok) return;
    // ONLY A SESSION THAT IS GONE signs out (2026-09-17). A refresh that
    // failed because the network did — a phone in a tunnel, the shop's
    // Wi-Fi dropping — is not a session gone bad, and signing the user out
    // for it is the bug. The SDK itself already drops a session the server
    // has revoked; the session adapter answers `PIPELINE_UNAUTHENTICATED`
    // exactly for the codes it reports for one (expired, unknown, disabled
    // or invalid user token, no user), every other failure as retryable.
    if (result.error.errorCode !== PipelineErrorCode.Unauthenticated) return;
    await this.session.signOut();
    void this.router.navigateByUrl('/auth');
  }
}
