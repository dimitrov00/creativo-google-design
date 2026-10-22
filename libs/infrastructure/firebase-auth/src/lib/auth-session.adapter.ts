import { Observable } from 'rxjs';
import {
  type Auth,
  getIdToken,
  onIdTokenChanged,
  signInWithCustomToken,
  signOut as firebaseSignOut,
} from 'firebase/auth';
import {
  AuthClaims,
  E164,
  Email,
  ParsedIdentifier,
  Principal,
} from '@core/components';
import {
  PipelineError,
  PipelineErrorCode,
  Result,
  UserId,
} from '@core/primitives';
import type { AuthSessionPorts } from '@core/ports';

/** The custom-claims bag AS STORED on a token (`AuthClaims.toToken`'s shape). */
type TokenClaims = { readonly [claim: string]: unknown };

/**
 * What the Auth EMULATOR forgets on every restart: who was signed in, with
 * which of the app's own claims — the claims AS THE TOKEN CARRIES THEM
 * (`AuthClaims.toToken`, the `stage` key), never the struct (whose key is
 * `authStage`): re-minted from the struct, every revived session would read
 * as onboarding (plan §9 R2). Kept in web storage so a reload after a
 * restart can still say who to bring back.
 */
type EmulatorSession = {
  readonly uid: string;
  readonly claims: TokenClaims;
};

const EMULATOR_SESSION_KEY = 'creativo.emulator-session';

/**
 * The SDK's codes for a session that no longer exists on the server —
 * answered `PIPELINE_UNAUTHENTICATED`, the one refresh failure the shell's
 * session check signs out for. Every other failure (a phone in a tunnel,
 * the shop's Wi-Fi dropping) is retryable: `PIPELINE_UNAVAILABLE`.
 */
const SESSION_GONE_CODES: ReadonlySet<unknown> = new Set<unknown>([
  'auth/user-token-expired',
  'auth/user-not-found',
  'auth/user-disabled',
  'auth/invalid-user-token',
  'auth/null-user',
]);

/** The SDK's `code` of a failure, `undefined` for anything else. */
function codeOf(error: unknown): unknown {
  return typeof error === 'object' && error !== null
    ? Object.getOwnPropertyDescriptor(error, 'code')?.value
    : undefined;
}

/** A failed refresh: the session is gone, or the network is. */
function refreshFailure(error: unknown): PipelineError {
  return PipelineError.bare(
    SESSION_GONE_CODES.has(codeOf(error))
      ? PipelineErrorCode.Unauthenticated
      : PipelineErrorCode.Unavailable,
  );
}

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
 * THE FIREBASE AUTH SESSION as the web's `AuthSessionPorts` (Phase 4a
 * §3.10; the closure successor of the retired auth-gateway class) — the one
 * place Firebase Auth's token stream (`onIdTokenChanged`) becomes a
 * `Principal`: `Principal.fromClaims({ userId, claims:
 * AuthClaims.fromToken(raw) })`, the ONE rule (a token whose claims carry no
 * tenant reads `ONBOARDING`, plan 4A-2 (b)). A closure keeping the gateway's
 * mutable state (the session ended on purpose, the single-flight revive).
 *
 * Deliberately not `subscribeWithRetry`: `onIdTokenChanged` doesn't fail
 * the way a live Firestore query does, it just reports `null`.
 *
 * THE EMULATOR FORGETS (2026-09-17; owner: "why is it logging out all the
 * time? isn't the session kept forever?"). In production a session IS
 * kept: the refresh token never expires unless revoked. The Auth emulator
 * keeps refresh tokens in memory only, so every restart of the dev stack —
 * and the dev stack restarts a lot — voids every session at its next
 * refresh, and the shell's five-minute session check then signs the
 * developer out. So, while the emulator is on, the session remembers who is
 * signed in and with which claims, and when the emulator no longer knows
 * them it signs them straight back in with an unsigned custom token — the
 * same thing the dev seed and the e2e hook do. A session ended ON PURPOSE
 * (`signOut`) is forgotten, never revived. None of this exists outside the
 * emulator: `auth.emulatorConfig` is the only switch.
 */
export const authSessionPorts = (auth: Auth): AuthSessionPorts => {
  let endedOnPurpose = false;
  let reviving: Promise<boolean> | null = null;

  const emulated = (): boolean => Boolean(auth.emulatorConfig);

  const remembered = (): EmulatorSession | null => {
    const raw = storage()?.getItem(EMULATOR_SESSION_KEY) ?? null;
    if (raw === null) return null;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed !== 'object' || parsed === null) return null;
      const uid: unknown = Object.getOwnPropertyDescriptor(
        parsed,
        'uid',
      )?.value;
      const claims: unknown = Object.getOwnPropertyDescriptor(
        parsed,
        'claims',
      )?.value;
      return typeof uid === 'string' &&
        typeof claims === 'object' &&
        claims !== null
        ? // Re-read through the one claims rule: a stored bag mints only
          // what `fromToken` would read back.
          {
            uid,
            claims: AuthClaims.toToken(
              AuthClaims.fromToken(Object.fromEntries(Object.entries(claims))),
            ),
          }
        : null;
    } catch {
      return null;
    }
  };

  const remember = (session: EmulatorSession): void => {
    storage()?.setItem(EMULATOR_SESSION_KEY, JSON.stringify(session));
  };

  const forget = (): void => {
    storage()?.removeItem(EMULATOR_SESSION_KEY);
  };

  /** Signs the remembered session back in against the emulator — once at a time; a refusal drops the memory. */
  const revive = (): Promise<boolean> => {
    if (reviving !== null) return reviving;
    const session = remembered();
    if (session === null) return Promise.resolve(false);
    reviving = signInWithCustomToken(auth, emulatorCustomToken(session))
      .then(() => true)
      .catch(() => {
        forget();
        return false;
      })
      .finally(() => {
        reviving = null;
      });
    return reviving;
  };

  return {
    observePrincipal: () =>
      new Observable<Principal>((subscriber) =>
        onIdTokenChanged(auth, (user) => {
          if (!user) {
            // Not "nobody": the emulator has forgotten somebody, and a
            // sign-in is on its way — the stream stays where it was until it
            // lands (a new token) or fails (anonymous, and the memory dropped).
            if (emulated() && !endedOnPurpose && remembered() !== null) {
              void revive().then((revived) => {
                if (!revived) subscriber.next(Principal.anonymous());
              });
              return;
            }
            subscriber.next(Principal.anonymous());
            return;
          }
          endedOnPurpose = false;
          void user
            .getIdTokenResult()
            .then((token) => {
              const claims = AuthClaims.fromToken(token.claims);
              if (emulated()) {
                remember({ uid: user.uid, claims: AuthClaims.toToken(claims) });
              }
              const userId = UserId.parse(user.uid);
              subscriber.next(
                userId.ok
                  ? Principal.fromClaims({ userId: userId.value, claims })
                  : Principal.anonymous(),
              );
            })
            .catch(() => {
              subscriber.next(Principal.anonymous());
            });
        }),
      ),

    refreshToken: async () => {
      const user = auth.currentUser;
      // Nobody to refresh for: no session gone, so nothing to sign out —
      // retryable, as the session check always read it.
      if (!user) {
        return Result.err(PipelineError.bare(PipelineErrorCode.Unavailable));
      }
      try {
        // Reload the Auth RECORD alongside the token: registration just
        // stamped `displayName` server-side, and without a reload the
        // session-cached record (the header monogram's source) would stay
        // blank until the next full sign-in.
        await user.reload();
        await getIdToken(user, /* forceRefresh */ true);
        return Result.ok(undefined);
      } catch (error) {
        // The emulator forgot this session: bring it back rather than report
        // a session gone bad.
        if (emulated() && (await revive())) return Result.ok(undefined);
        return Result.err(refreshFailure(error));
      }
    },

    signOut: async () => {
      endedOnPurpose = true;
      forget();
      try {
        await firebaseSignOut(auth);
        return Result.ok(undefined);
      } catch {
        return Result.err(PipelineError.bare(PipelineErrorCode.Unavailable));
      }
    },

    /**
     * The Auth record's phone (E.164) or e-mail, set by provisioning from an
     * identifier that was already parsed — so the trusted rebuild, no
     * re-validation; a phone wins when both are somehow present, matching
     * provisioning's either/or write.
     */
    currentIdentifier: () => {
      const user = auth.currentUser;
      if (!user) return null;
      if (user.phoneNumber) {
        return ParsedIdentifier.phone(E164.of(user.phoneNumber));
      }
      if (user.email) return ParsedIdentifier.email(Email.of(user.email));
      return null;
    },

    currentDisplayName: () => auth.currentUser?.displayName || null,
  };
};
