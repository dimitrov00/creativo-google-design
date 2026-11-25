import {
  ImpersonationSessionId,
  Tag,
  UserId,
  UtcEpochMs,
} from '@core/primitives';
import { ImpersonationScope } from './impersonation-scope.data';

/**
 * THE READ-AS FACTS ON A TOKEN (OR-24, docs/designs/support-read-as.md): a
 * support read-as signs in AS the target — the custom token's `uid` is the
 * target, its claims are the target's own (`AuthClaims`) — and these four
 * ride beside them, so the rules, the callable edge and the web's banner can
 * tell the session apart without a read. Flat, every key present; the
 * struct names are domain-prefixed (Law 6.2), the CLAIM keys are short
 * because a token's claims are a byte budget and the rules spell them:
 *
 * | Field                   | Claim      |
 * | ----------------------- | ---------- |
 * | `readAsSessionId`       | `imp`      |
 * | `readAsByUserId`        | `impBy`    |
 * | `readAsScope`           | `impScope` |
 * | `readAsExpiresAtUtcMs`  | `impExp`   |
 *
 * `impExp` is the session's own expiry. Firebase keeps a custom token's
 * claims on every ID token of that session, refreshes included, so the
 * window is enforced by comparing it with the clock — the rules'
 * `isSignedIn()`, the edge and the web's own sign-out — never by the
 * token's lifetime.
 */
export type ReadAsClaims = {
  readonly readAsSessionId: ImpersonationSessionId;
  readonly readAsByUserId: UserId;
  readonly readAsScope: ImpersonationScope;
  readonly readAsExpiresAtUtcMs: UtcEpochMs;
};

/** The claim keys — the ONE place they are spelled; `firestore.rules` and `storage.rules` read them too. */
export const ReadAsClaim = {
  Session: 'imp',
  By: 'impBy',
  Scope: 'impScope',
  ExpiresAt: 'impExp',
} as const;
export type ReadAsClaim = (typeof ReadAsClaim)[keyof typeof ReadAsClaim];

export const ReadAsClaims = {
  /** The four claims as the token stores them — the inverse of {@link ReadAsClaims.fromToken}. */
  toToken(claims: ReadAsClaims): { readonly [claim: string]: unknown } {
    return {
      [ReadAsClaim.Session]: claims.readAsSessionId,
      [ReadAsClaim.By]: claims.readAsByUserId,
      [ReadAsClaim.Scope]: claims.readAsScope,
      [ReadAsClaim.ExpiresAt]: claims.readAsExpiresAtUtcMs,
    };
  },

  /**
   * Whether the token claims a read-as at all — the session claim is
   * present, whatever its value. A token that claims one but whose claims
   * do not read ({@link ReadAsClaims.fromToken} answers `null`) is treated
   * as an ENDED read-as, never as a plain session: a malformed claim must
   * not unlock a write.
   */
  claimed(raw: { readonly [claim: string]: unknown }): boolean {
    return Object.prototype.hasOwnProperty.call(raw, ReadAsClaim.Session);
  },

  /** The raw claims bag → the four facts, or `null` when they are absent or do not read. */
  fromToken(raw: { readonly [claim: string]: unknown }): ReadAsClaims | null {
    const session = raw[ReadAsClaim.Session];
    const by = raw[ReadAsClaim.By];
    const scope = raw[ReadAsClaim.Scope];
    const expiresAt = raw[ReadAsClaim.ExpiresAt];
    if (
      typeof session !== 'string' ||
      typeof by !== 'string' ||
      typeof scope !== 'string' ||
      typeof expiresAt !== 'number' ||
      !Tag.has(ImpersonationScope, scope)
    ) {
      return null;
    }
    const sessionId = ImpersonationSessionId.parse(session);
    const byUserId = UserId.parse(by);
    const expires = UtcEpochMs.of(expiresAt);
    if (!sessionId.ok || !byUserId.ok || !expires.ok) return null;
    return {
      readAsSessionId: sessionId.value,
      readAsByUserId: byUserId.value,
      readAsScope: scope,
      readAsExpiresAtUtcMs: expires.value,
    };
  },

  /** The window is still open at `nowUtcMs` — closed from `impExp` itself on, as `ImpersonationSystem.isExpired` reads a session. */
  isLive(claims: ReadAsClaims, nowUtcMs: UtcEpochMs): boolean {
    return UtcEpochMs.compare(nowUtcMs, claims.readAsExpiresAtUtcMs) < 0;
  },
} as const;
