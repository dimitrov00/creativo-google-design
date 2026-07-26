import { InjectionToken } from '@angular/core';
import { Observable } from 'rxjs';
import { Result } from '@creativo/domain/kernel';
import { Identifier, Principal } from '@creativo/domain/identity';

export class AuthGatewayError extends Error {
  constructor(
    message: string,
    public override readonly cause?: unknown,
  ) {
    super(message);
  }
}

/**
 * Web-facing wrapper over Firebase Auth's single `onIdTokenChanged`
 * listener (blueprint §6) — the ONE place the SDK's token stream gets
 * parsed into a `Principal`. `refreshToken` forces a fresh ID token fetch
 * (custom claims can lag right after sign-in/registration — see
 * `EnsureSessionReadyUseCase`'s backoff).
 */
export interface AuthGateway {
  observePrincipal(): Observable<Principal>;
  refreshToken(): Promise<Result<void, AuthGatewayError>>;
  signOut(): Promise<Result<void, AuthGatewayError>>;
  /**
   * The channel the signed-in user authenticated with — derived from the
   * Auth record's phoneNumber/email (set at provisioning, so trusted, not
   * re-validated). `null` while signed out or when the record carries
   * neither. Replaces feature code injecting `FIREBASE_AUTH` directly to
   * read `currentUser` — the seam matters more once OAuth providers add
   * their own `providerData` shapes behind this same port.
   */
  currentIdentifier(): Identifier | null;

  /**
   * The Auth record's display name — stamped by `completeRegistration`
   * server-side, feeds session-cached identity chrome (the header's
   * account monogram) without a Firestore read. `null` while signed out or
   * for sessions that registered before the stamp existed (the chrome
   * falls back to the identifier's initial).
   */
  currentDisplayName(): string | null;
}

export const AUTH_GATEWAY = new InjectionToken<AuthGateway>('AuthGateway');
