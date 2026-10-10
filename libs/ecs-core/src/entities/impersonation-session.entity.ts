import type { ImpersonationScope } from '../components/impersonation-scope.data';
import type { ImpersonationStatus } from '../components/impersonation-status.data';
import type { UserId } from './user.entity';

export type ImpersonationSessionId = string & {
  readonly __brand: unique symbol;
};

export const ImpersonationSessionId = {
  /** The only cast site. Validate the raw string at the edge, not here. */
  of: (raw: string): ImpersonationSessionId => raw as ImpersonationSessionId,
} as const;

/**
 * A time-bounded, audited session in which a staff member acts on behalf of
 * a target user — the stored body of `impersonation.adapter.ts:55-65`
 * (blueprint §2.6), ISO stamps as epoch ms. The document body is this type
 * minus `id`.
 *
 * A session that lapses at `expiresAtMs` without anyone calling end keeps
 * `status.kind: 'active'` — `ImpersonationSystem.isExpired` is the rule an
 * authorization decision reads, never the stored status alone. `purgeAt` is
 * adapter-stamped at the root (`expiresAtMs` + 30 d at start, re-stamped to
 * `endedAtMs` + 30 d at end) and is not an entity field.
 */
export type ImpersonationSessionEntity = {
  readonly id: ImpersonationSessionId;
  readonly adminUserId: UserId;
  readonly targetUserId: UserId;
  readonly scope: ImpersonationScope;
  /** The recorded justification — never blank. */
  readonly reason: string;
  readonly startedAtMs: number;
  /** Strictly after `startedAtMs`. */
  readonly expiresAtMs: number;
  readonly status: ImpersonationStatus;
};
