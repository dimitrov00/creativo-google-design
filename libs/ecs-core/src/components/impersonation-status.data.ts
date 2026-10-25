import { Result, Tag, type UtcEpochMs } from '@core/primitives';
import { GovernanceError } from '@core/errors';
import type { EndReasonFields } from './end-reason-fields.data';
import { ImpersonationScope } from './impersonation-scope.data';

/**
 * Session status tags — the ONLY source of these strings, the discriminator
 * `impersonationStatus` of {@link ImpersonationLifecycle} (today's stored
 * `impersonationSessions.status.kind`, upper-snaked; flatten-spec §3.7).
 */
export const ImpersonationStatus = {
  Active: 'ACTIVE',
  Ended: 'ENDED',
} as const;
export type ImpersonationStatus =
  (typeof ImpersonationStatus)[keyof typeof ImpersonationStatus];

/**
 * The lifecycle slice of an impersonation session — `ENDED` structurally
 * CARRIES its instant and reason (flat at the session's root), so an active
 * session can never hold a dangling end reason. The expiry rule is not here:
 * a stored `ACTIVE` row may be past `expiresAtUtcMs`, and
 * `ImpersonationSystem.isExpired` is what an authorization decision reads.
 */
export type ImpersonationLifecycle =
  ImpersonationLifecycle.Active | ImpersonationLifecycle.Ended;

const ACTIVE: ImpersonationLifecycle.Active = {
  impersonationStatus: ImpersonationStatus.Active,
};

export const ImpersonationLifecycle = {
  active(): ImpersonationLifecycle.Active {
    return ACTIVE;
  },

  /**
   * Close an active lifecycle at `endedAtUtcMs` for `reason` — or `null`
   * when it already ended: the first end wins, and the caller (which knows
   * the session id) words the refusal
   * `GOVERNANCE_IMPERSONATION_SESSION_ALREADY_ENDED`.
   */
  end(
    lifecycle: ImpersonationLifecycle,
    endedAtUtcMs: UtcEpochMs,
    reason: EndReasonFields,
  ): ImpersonationLifecycle.Ended | null {
    if (lifecycle.impersonationStatus !== ImpersonationStatus.Active) {
      return null;
    }
    return {
      impersonationStatus: ImpersonationStatus.Ended,
      endedAtUtcMs,
      ...reason,
    };
  },

  isActive(
    lifecycle: ImpersonationLifecycle,
  ): lifecycle is ImpersonationLifecycle.Active {
    return lifecycle.impersonationStatus === ImpersonationStatus.Active;
  },

  /**
   * The edge guard with a refusal for the session's `impersonationScope`: a
   * known scope, or `GOVERNANCE_IMPERSONATION_SCOPE_INVALID`.
   */
  parseScope(raw: string): Result<ImpersonationScope, GovernanceError> {
    return Tag.has(ImpersonationScope, raw)
      ? Result.ok(raw)
      : Result.err(GovernanceError.impersonationScopeInvalid(raw));
  },
} as const;

export namespace ImpersonationLifecycle {
  export type Active = {
    readonly impersonationStatus: typeof ImpersonationStatus.Active;
  };
  export type Ended = {
    readonly impersonationStatus: typeof ImpersonationStatus.Ended;
    readonly endedAtUtcMs: UtcEpochMs;
  } & EndReasonFields;
}
