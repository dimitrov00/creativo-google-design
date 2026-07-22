import {
  Result,
  ZonedDateTime,
  combineAll,
  fail,
  ok,
} from '@creativo/domain/kernel';
import {
  EmptyIdError as AccountsEmptyIdError,
  UserId,
} from '@creativo/domain/accounts';
import { Actor } from './actor';
import { AuditEntryId } from './ids';
import {
  AuditEntryValidationError,
  EmptyAuditActionError,
} from './audit-entry.errors';

const INSTANT_ZONE = 'UTC';

export interface AuditEntryProps {
  id: string;
  actor: Actor;
  /** Free-form snake_case code — `'register_user'`, `'start_impersonation'`, `'end_impersonation'`, `'cancel_appointment'`. Cardinality is bounded by code paths, not runtime input, so this stays a validated string rather than a closed union — a closed enum would force every new mutation through a domain-layer edit for no behavioral gain. */
  action: string;
  atIso: string;
  /** The user whose record was affected, if any. For an impersonator actor this is normally the target user — the impersonator's own id lives on `actor.adminUserId`. */
  targetUserId?: string;
  /** Free-form id of the resource the action mutated (an `ImpersonationSessionId`, a booking id, ...). Plain string, deliberately: the audit log doesn't carry a dependency on every aggregate's own id-brand type — action + resourceId is enough to navigate back to the source. */
  resourceId?: string;
  /** Small human-readable detail bag for the admin audit view. Not for structured data a consumer needs to parse — that belongs as a typed field on a dedicated shape if this ever needs to grow one. */
  context?: Readonly<Record<string, string>>;
}

/**
 * **Aggregate root.** Append-only audit log entry — one row per mutation
 * that wants a permanent "who did what to whom, when" trail (ported from
 * v2's `AuditEntry`). Distinct from a user-facing activity feed: this is
 * admin-facing — compliance queries, support investigations, "what did
 * the impersonator do" replays.
 *
 * Invariants:
 *   - Append-only — nothing here mutates `this`; a correction is a fresh
 *     entry, never an edit.
 *   - `action` must be a non-empty, trimmed string.
 *   - `at` is meant to be server/clock-supplied by the caller, never
 *     sourced from untrusted client input — the domain itself can't
 *     enforce that (it has no side effects), so this is a use-case-layer
 *     discipline note, not a checkable invariant here.
 */
export class AuditEntry {
  private constructor(
    readonly id: AuditEntryId,
    readonly actor: Actor,
    readonly action: string,
    readonly at: ZonedDateTime,
    readonly targetUserId: UserId | null,
    readonly resourceId: string | null,
    readonly context: Readonly<Record<string, string>> | null,
  ) {}

  /** Pure constructor from the use case's point of view — same validation whether this is a brand-new row or one read back from persistence (append-only logs have no creation-only invariant to skip). */
  static create(
    props: AuditEntryProps,
  ): Result<AuditEntry, AuditEntryValidationError[]> {
    return AuditEntry.build(props);
  }

  static reconstitute(
    props: AuditEntryProps,
  ): Result<AuditEntry, AuditEntryValidationError[]> {
    return AuditEntry.build(props);
  }

  private static build(
    props: AuditEntryProps,
  ): Result<AuditEntry, AuditEntryValidationError[]> {
    const idResult = AuditEntryId.create(props.id);
    const actionResult = AuditEntry.validateAction(props.action);
    const atResult = ZonedDateTime.fromISO(props.atIso, INSTANT_ZONE);
    const targetUserIdResult: Result<UserId | null, AccountsEmptyIdError> =
      props.targetUserId !== undefined
        ? UserId.create(props.targetUserId)
        : ok(null);

    const combined = combineAll([
      idResult,
      actionResult,
      atResult,
      targetUserIdResult,
    ] as const);
    if (combined.isFailure()) {
      return fail(combined.error);
    }
    const [id, action, at, targetUserId] = combined.value;

    return ok(
      new AuditEntry(
        id,
        props.actor,
        action,
        at,
        targetUserId,
        props.resourceId ?? null,
        props.context ?? null,
      ),
    );
  }

  private static validateAction(
    raw: string,
  ): Result<string, EmptyAuditActionError> {
    const trimmed = raw.trim();
    return trimmed.length > 0 ? ok(trimmed) : fail(new EmptyAuditActionError());
  }
}
