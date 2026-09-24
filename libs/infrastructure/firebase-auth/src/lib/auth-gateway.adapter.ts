import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import {
  getIdToken,
  onIdTokenChanged,
  signInWithCustomToken,
  signOut as firebaseSignOut,
} from 'firebase/auth';
import { Result, fail, ok } from '@creativo/domain/kernel';
import { AuthGateway, AuthGatewayError } from '@creativo/application/identity';
import {
  ANONYMOUS_PRINCIPAL,
  AuthClaims,
  Identifier,
  Principal,
  PrincipalId,
  parseAuthClaims,
  principalFrom,
  reconstituteIdentifier,
} from '@creativo/domain/identity';
import { FIREBASE_AUTH } from '@creativo/infrastructure/firebase-app';

/**
 * What the Auth EMULATOR forgets on every restart: who was signed in, with
 * which of the app's own claims. Kept in web storage so a reload after a
 * restart can still say who to bring back.
 */
interface EmulatorSession {
  readonly uid: string;
  readonly claims: AuthClaims;
}

const EMULATOR_SESSION_KEY = 'creativo.emulator-session';

/**
 * An UNSIGNED custom token — `alg: none`, an empty signature — which is all
 * the Auth emulator asks for (firebase-admin mints exactly this against it,
 * and `window.__e2eSignIn` feeds it the same). Worthless anywhere else: the
 * production Auth service rejects an unsigned token outright, and this is
 * only ever minted while `auth.emulatorConfig` says the emulator is on.
 */
function emulatorCustomToken(session: EmulatorSession): string {
  const encode = (value: unknown): string =>
    btoa(JSON.stringify(value))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  const now = Math.floor(Date.now() / 1000);
  const header = encode({ alg: 'none', typ: 'JWT' });
  const payload = encode({
    aud: 'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit',
    iat: now,
    exp: now + 3600,
    iss: 'firebase-auth-emulator@example.com',
    sub: 'firebase-auth-emulator@example.com',
    uid: session.uid,
    claims: session.claims,
  });
  return `${header}.${payload}.`;
}

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

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

  /**
   * THE EMULATOR FORGETS (2026-09-17; owner: "why is it logging out all
   * the time? isn't the session kept forever?"). In production a session
   * IS kept: the refresh token never expires unless revoked. The Auth
   * emulator keeps refresh tokens in memory only, so every restart of the
   * dev stack — and the dev stack restarts a lot — voids every session at
   * its next refresh, and the shell's five-minute session check then signs
   * the developer out. So, while the emulator is on, the gateway remembers
   * who is signed in and with which claims, and when the emulator no longer
   * knows them it signs them straight back in with an unsigned custom token
   * — the same thing the dev seed and the e2e hook do. A session ended ON
   * PURPOSE (`signOut`) is forgotten, never revived. None of this exists
   * outside the emulator: `auth.emulatorConfig` is the only switch.
   */
  private get emulated(): boolean {
    return Boolean(this.auth.emulatorConfig);
  }
  private endedOnPurpose = false;
  private reviving: Promise<boolean> | null = null;

  observePrincipal(): Observable<Principal> {
    return new Observable<Principal>((subscriber) => {
      const unsubscribe = onIdTokenChanged(this.auth, (user) => {
        if (!user) {
          // Not "nobody": the emulator has forgotten somebody, and a sign-in
          // is on its way — the stream stays where it was until it lands
          // (a new token) or fails (anonymous, and the memory dropped).
          if (this.emulated && !this.endedOnPurpose && this.remembered()) {
            void this.revive().then((revived) => {
              if (!revived) subscriber.next(ANONYMOUS_PRINCIPAL);
            });
            return;
          }
          subscriber.next(ANONYMOUS_PRINCIPAL);
          return;
        }
        this.endedOnPurpose = false;
        void user
          .getIdTokenResult()
          .then((tokenResult) => {
            const claims = parseAuthClaims(tokenResult.claims);
            if (this.emulated) this.remember({ uid: user.uid, claims });
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
      // Reload the Auth RECORD alongside the token: registration just
      // stamped `displayName` server-side, and without a reload the
      // session-cached record (the header monogram's source) would stay
      // blank until the next full sign-in.
      await user.reload();
      await getIdToken(user, /* forceRefresh */ true);
      return ok(undefined);
    } catch (error) {
      // The emulator forgot this session: bring it back rather than report
      // a session gone bad (see `emulated`).
      if (this.emulated && (await this.revive())) return ok(undefined);
      return fail(new AuthGatewayError('Failed to refresh ID token', error));
    }
  }

  async signOut(): Promise<Result<void, AuthGatewayError>> {
    this.endedOnPurpose = true;
    this.forget();
    try {
      await firebaseSignOut(this.auth);
      return ok(undefined);
    } catch (error) {
      return fail(new AuthGatewayError('Failed to sign out', error));
    }
  }

  currentIdentifier(): Identifier | null {
    const user = this.auth.currentUser;
    if (!user) return null;
    // The Auth record's phoneNumber (E.164) / email were set by the
    // provisioning use-case from an already-validated Identifier, so
    // `reconstituteIdentifier` (trusted rebuild, no re-validation) is the
    // right factory here — phone wins when both are somehow present,
    // matching provisioning's either/or write.
    if (user.phoneNumber) {
      return reconstituteIdentifier({ kind: 'phone', value: user.phoneNumber });
    }
    if (user.email) {
      return reconstituteIdentifier({ kind: 'email', value: user.email });
    }
    return null;
  }

  currentDisplayName(): string | null {
    return this.auth.currentUser?.displayName || null;
  }

  /** Signs the remembered session back in against the emulator — once at a time; a refusal drops the memory. */
  private revive(): Promise<boolean> {
    if (this.reviving !== null) return this.reviving;
    const session = this.remembered();
    if (session === null) return Promise.resolve(false);
    this.reviving = signInWithCustomToken(
      this.auth,
      emulatorCustomToken(session),
    )
      .then(() => true)
      .catch(() => {
        this.forget();
        return false;
      })
      .finally(() => {
        this.reviving = null;
      });
    return this.reviving;
  }

  private remembered(): EmulatorSession | null {
    const raw = storage()?.getItem(EMULATOR_SESSION_KEY) ?? null;
    if (raw === null) return null;
    try {
      const parsed = JSON.parse(raw) as Partial<EmulatorSession>;
      return typeof parsed.uid === 'string' && parsed.claims !== undefined
        ? { uid: parsed.uid, claims: parsed.claims }
        : null;
    } catch {
      return null;
    }
  }

  private remember(session: EmulatorSession): void {
    storage()?.setItem(EMULATOR_SESSION_KEY, JSON.stringify(session));
  }

  private forget(): void {
    storage()?.removeItem(EMULATOR_SESSION_KEY);
  }
}
