import { InjectionToken } from '@angular/core';
import { Observable } from 'rxjs';
import { Result } from '@creativo/domain/kernel';
import { Principal } from '@creativo/domain/identity';

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
}

export const AUTH_GATEWAY = new InjectionToken<AuthGateway>('AuthGateway');
