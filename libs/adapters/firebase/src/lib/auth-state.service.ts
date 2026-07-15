import { Injectable, computed, inject, signal } from '@angular/core';
import { ParsedToken, User, onIdTokenChanged } from 'firebase/auth';
import { SessionClaims } from '@creativo/domain/models';
import { FIREBASE_AUTH } from './firebase-app.provider';

/**
 * Wraps Firebase Auth's ID-token listener into signals, following the same
 * inject()+signal idiom as ThemeService/CursorService. Custom claims
 * (tenantId/role) are decoded from the ID token, not fabricated client-side.
 */
@Injectable({ providedIn: 'root' })
export class AuthStateService {
  private readonly auth = inject(FIREBASE_AUTH);

  private readonly _currentUser = signal<User | null>(null);
  private readonly _claims = signal<SessionClaims | null>(null);

  readonly currentUser = this._currentUser.asReadonly();
  readonly claims = this._claims.asReadonly();
  readonly isSignedIn = computed(() => this._currentUser() !== null);

  constructor() {
    onIdTokenChanged(this.auth, (user) => {
      this._currentUser.set(user);
      if (!user) {
        this._claims.set(null);
        return;
      }
      void this.loadClaims(user);
    });
  }

  /**
   * Custom claims minted via `admin.auth().createCustomToken()` do not
   * appear on the ID token until a forced refresh — call this right after
   * `signInWithCustomToken()` resolves, not just after a normal sign-in,
   * or `claims()` will read stale/empty for one tick.
   */
  async refreshClaims(): Promise<void> {
    const user = this.auth.currentUser;
    if (!user) {
      return;
    }
    await this.loadClaims(user, /* forceRefresh */ true);
  }

  private async loadClaims(user: User, forceRefresh = false): Promise<void> {
    const tokenResult = await user.getIdTokenResult(forceRefresh);
    this._claims.set(this.parseClaims(tokenResult.claims));
  }

  private parseClaims(claims: ParsedToken): SessionClaims | null {
    const result = SessionClaims.fromToken(claims);
    return result.isSuccess() ? result.value : null;
  }
}
