import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import {
  getIdToken,
  onIdTokenChanged,
  signOut as firebaseSignOut,
} from 'firebase/auth';
import { Result, fail, ok } from '@creativo/domain/kernel';
import { AuthGateway, AuthGatewayError } from '@creativo/application/identity';
import {
  ANONYMOUS_PRINCIPAL,
  Principal,
  PrincipalId,
  parseAuthClaims,
  principalFrom,
} from '@creativo/domain/identity';
import { FIREBASE_AUTH } from '@creativo/infrastructure/firebase-app';

/**
 * The one place Firebase Auth's token stream (`onIdTokenChanged`) is parsed
 * into a `Principal` (blueprint §6). Deliberately does NOT go through
 * `subscribeWithRetry` (that helper lives in the `firestore` lib and wraps
 * values in `Result<T, RepositoryError>`, which doesn't fit this port's
 * plain `Observable<Principal>` — `onIdTokenChanged` doesn't fail the way
 * a live Firestore query subscription does, it just reports `null`).
 */
@Injectable()
export class FirebaseAuthGateway implements AuthGateway {
  private readonly auth = inject(FIREBASE_AUTH);

  observePrincipal(): Observable<Principal> {
    return new Observable<Principal>((subscriber) => {
      const unsubscribe = onIdTokenChanged(this.auth, (user) => {
        if (!user) {
          subscriber.next(ANONYMOUS_PRINCIPAL);
          return;
        }
        void user
          .getIdTokenResult()
          .then((tokenResult) => {
            const claims = parseAuthClaims(tokenResult.claims);
            const uidResult = PrincipalId.create(user.uid);
            subscriber.next(
              uidResult.isSuccess()
                ? principalFrom({ uid: uidResult.value, claims })
                : ANONYMOUS_PRINCIPAL,
            );
          })
          .catch(() => {
            subscriber.next(ANONYMOUS_PRINCIPAL);
          });
      });
      return unsubscribe;
    });
  }

  async refreshToken(): Promise<Result<void, AuthGatewayError>> {
    const user = this.auth.currentUser;
    if (!user) {
      return fail(
        new AuthGatewayError('No signed-in user to refresh a token for'),
      );
    }
    try {
      await getIdToken(user, /* forceRefresh */ true);
      return ok(undefined);
    } catch (error) {
      return fail(new AuthGatewayError('Failed to refresh ID token', error));
    }
  }

  async signOut(): Promise<Result<void, AuthGatewayError>> {
    try {
      await firebaseSignOut(this.auth);
      return ok(undefined);
    } catch (error) {
      return fail(new AuthGatewayError('Failed to sign out', error));
    }
  }
}
