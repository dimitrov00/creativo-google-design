import {
  AppCheckMode,
  AppCheckOutcome,
  AppCheckTokenUse,
  Result,
} from '@core/primitives';
import { AppCheckError } from '@core/errors';

/**
 * AppCheckSystem — what the callable edge decides about one request's App
 * Check token (security hardening S-WS-A, S-RU-17, S-L-1). Pure: the edge
 * reads the facts off the request (presence of the header, the platform's
 * verification — never the token) and the switch, then asks here FIRST,
 * before it decodes, digests or budgets anything.
 *
 * The switch is staged so a rollout can never lock out the current build:
 * OFF reports nothing and refuses nothing; MONITOR reports the outcome and
 * refuses nothing; only ENFORCE refuses — a missing or unverifiable token
 * on every callable, a replayed one only on a `LIMITED_USE` callable (the
 * platform refuses no replay itself, so the edge must).
 */

/** What the edge read off one request — presence and the platform's verdict, never the token. */
export type AppCheckFacts = {
  /** An `X-Firebase-AppCheck` header arrived. */
  readonly appCheckTokenSent: boolean;
  /** The platform verified it (`request.app` is set). */
  readonly appCheckTokenVerified: boolean;
  /** The platform had consumed it before (`request.app.alreadyConsumed === true`). */
  readonly appCheckTokenReplayed: boolean;
};

export const AppCheckSystem = {
  /**
   * The outcome tag, in precedence order: no header → MISSING; a header the
   * platform did not verify → INVALID; a verified token already consumed →
   * REPLAYED; else VALID. A replay flag without a verified token cannot
   * come from the platform and reads as what it is: unverified.
   */
  outcomeOf(facts: AppCheckFacts): AppCheckOutcome {
    if (!facts.appCheckTokenSent) return AppCheckOutcome.Missing;
    if (!facts.appCheckTokenVerified) return AppCheckOutcome.Invalid;
    if (facts.appCheckTokenReplayed) return AppCheckOutcome.Replayed;
    return AppCheckOutcome.Valid;
  },

  /**
   * The edge's verdict. OFF → `ok(null)` (nothing reported); MONITOR →
   * `ok(outcome)`; ENFORCE → VALID `ok`; MISSING / INVALID →
   * `required(outcome)`; REPLAYED → `replayed()` on a LIMITED_USE callable,
   * `ok(REPLAYED)` on a STANDARD one (a standard token is reused by design).
   */
  verdictOf(
    mode: AppCheckMode,
    facts: AppCheckFacts,
    tokenUse: AppCheckTokenUse,
  ): Result<AppCheckOutcome | null, AppCheckError> {
    if (mode === AppCheckMode.Off) return Result.ok(null);
    const outcome = AppCheckSystem.outcomeOf(facts);
    if (mode === AppCheckMode.Monitor) return Result.ok(outcome);
    if (
      outcome === AppCheckOutcome.Missing ||
      outcome === AppCheckOutcome.Invalid
    ) {
      return Result.err(AppCheckError.required(outcome));
    }
    if (
      outcome === AppCheckOutcome.Replayed &&
      tokenUse === AppCheckTokenUse.LimitedUse
    ) {
      return Result.err(AppCheckError.replayed());
    }
    return Result.ok(outcome);
  },
} as const;
