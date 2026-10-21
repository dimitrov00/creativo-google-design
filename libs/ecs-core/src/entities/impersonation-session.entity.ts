import type {
  ImpersonationScope,
  ImpersonationLifecycle,
} from '@core/components';
import type {
  ImpersonationSessionId,
  UserId,
  UtcEpochMs,
} from '@core/primitives';

/**
 * The identity slice of an impersonation session: who acts as whom, under
 * which scope, why, and the window. Both parties are ACCOUNTS (`UserId`,
 * D29). `expiresAtUtcMs` is strictly after `startedAtUtcMs`.
 */
export type ImpersonationSessionMeta = {
  readonly id: ImpersonationSessionId;
  readonly adminUserId: UserId;
  readonly targetUserId: UserId;
  readonly impersonationScope: ImpersonationScope;
  /** The recorded justification — never blank. */
  readonly reason: string;
  readonly startedAtUtcMs: UtcEpochMs;
  readonly expiresAtUtcMs: UtcEpochMs;
};

/**
 * A time-bounded, audited session in which a staff member acts on behalf of
 * a target user — `impersonationSessions/{id}`, flat (Law 6): the meta slice
 * and the lifecycle (`impersonationStatus`; an ended session's
 * `endedAtUtcMs` and end-reason fields at the root). The document body is
 * this type minus `id`, byte for byte — the web reads it as is
 * (`observeActiveImpersonation`, `adminUserId ==` and
 * `impersonationStatus == 'ACTIVE'`, index #9); the start and end writes
 * arrive with Phase 4's callables.
 *
 * A session that lapses at `expiresAtUtcMs` without anyone calling end
 * keeps `impersonationStatus: 'ACTIVE'` — `ImpersonationSystem.isExpired`
 * is the rule an authorization decision reads, never the stored status
 * alone. `purgeAt` is adapter-stamped at the root and is not an entity
 * field.
 */
export type ImpersonationSession = ImpersonationSessionMeta &
  ImpersonationLifecycle;
