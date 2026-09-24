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
    if (result.isSuccess()) return;
    // ONLY A SESSION THAT IS GONE signs out (2026-09-17). A refresh that
    // failed because the network did — a phone in a tunnel, the shop's
    // Wi-Fi dropping — is not a session gone bad, and signing the user out
    // for it is the bug. The SDK itself already drops a session the server
    // has revoked; this catches the codes it reports for one.
    if (!sessionIsGone(result.error)) return;
    await this.authGateway.signOut();
    void this.router.navigateByUrl('/auth');
  }
}

/** The SDK's codes for a session that no longer exists on the server. */
const SESSION_GONE_CODES = new Set([
  'auth/user-token-expired',
  'auth/user-not-found',
  'auth/user-disabled',
  'auth/invalid-user-token',
  'auth/null-user',
]);

function sessionIsGone(error: unknown): boolean {
  const cause = (error as { cause?: unknown } | null)?.cause;
  const code = (cause as { code?: unknown } | null)?.code;
  return typeof code === 'string' && SESSION_GONE_CODES.has(code);
}
