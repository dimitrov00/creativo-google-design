import type { ImpersonationScope } from '../components/impersonation-scope.data';
import type { ImpersonationLifecycle } from '../components/impersonation-status.data';
import type {
  ImpersonationSessionId,
  UserId,
} from '../primitives/ids.primitive';
import type { UtcEpochMs } from '../primitives/utc-epoch-ms.primitive';

/*
 * Staging re-export (flatten-pass): `ImpersonationSessionId` is declared in
 * `primitives/ids.primitive.ts` (flatten-spec §1.5); the barrel's staging
 * block and the unconverted relative importers still name it from this
 * file. The integrator deletes this line with the barrel's block.
 */

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
 * this type minus `id`; until the governance flip the stored bytes are
 * today's (the shims convert).
 *
 * A session that lapses at `expiresAtUtcMs` without anyone calling end
 * keeps `impersonationStatus: 'ACTIVE'` — `ImpersonationSystem.isExpired`
 * is the rule an authorization decision reads, never the stored status
 * alone. `purgeAt` is adapter-stamped at the root and is not an entity
 * field.
 */
export type ImpersonationSession = ImpersonationSessionMeta &
  ImpersonationLifecycle;
