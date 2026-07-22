import { Injectable, effect, inject } from '@angular/core';
import { Router } from '@angular/router';
import { AUTH_GATEWAY } from '@creativo/application/identity';
import { AccountStateService } from '@creativo/features/client/account-state';

const CHECK_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Mirrors v2's `SessionExpiryGuard` (`src/lib/auth/session-expiry.ts`) at a
 * reduced fidelity: v2 enforces a long-lived `sessionExpiry` custom claim
 * distinct from routine ID-token refresh; `AuthClaims`/`Principal` in this
 * codebase carry no such field yet (a domain-layer gap outside this app-
 * shell goal's scope — adding it would mean editing Phase 2's domain
 * output). Until that claim exists, this polls `refreshToken()` while
 * signed in and treats a refresh failure as the session having gone bad —
 * catching the same class of "stale session sitting on a page" problem
 * the guard exists for, via the one signal already available.
 */
@Injectable({ providedIn: 'root' })
export class SessionExpiryService {
  private readonly authGateway = inject(AUTH_GATEWAY);
  private readonly account = inject(AccountStateService);
  private readonly router = inject(Router);

  constructor() {
    effect((onCleanup) => {
      if (this.account.principal().kind === 'anonymous') return;

      const id = setInterval(() => void this.checkSession(), CHECK_INTERVAL_MS);
      onCleanup(() => clearInterval(id));
    });
  }

  private async checkSession(): Promise<void> {
    const result = await this.authGateway.refreshToken();
    if (result.isFailure()) {
      await this.authGateway.signOut();
      void this.router.navigateByUrl('/auth');
    }
  }
}
