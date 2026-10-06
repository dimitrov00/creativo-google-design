import { Result, ZonedDateTime, fail, ok } from '@creativo/domain/kernel';
import {
  AccountStatus,
  type BlockReason,
  parseBlockReason,
} from '@creativo/domain/accounts';
import { RepositoryError } from './repository.errors';

/**
 * `users/{uid}.status` — the persisted `AccountStatus`, and from P2 the
 * client-readable projection of a pause (client-details spec §3.8, R48).
 * Two SDKs touch it: the functions write it through `firebase-admin`
 * (registration today, pause projections later) and the web reads it back
 * through `firebase/firestore`. One mapper for both, here in the port layer
 * like `audit-log-document.ts`: plain objects, no SDK.
 */
export interface AccountStatusDocument {
  readonly kind: 'active' | 'blocked';
  readonly reason?: string;
  readonly untilIso?: string | null;
}

/** The zone a stored `untilIso` is read back in — the shop's own. */
const STATUS_ZONE = 'Europe/Sofia';

export function accountStatusToDocument(
  status: AccountStatus,
): AccountStatusDocument {
  if (status.kind === 'active') {
    return { kind: 'active' };
  }
  return {
    kind: 'blocked',
    reason: status.reason,
    untilIso: status.until ? status.until.toISO() : null,
  };
}

function isAccountStatusDocument(raw: unknown): raw is AccountStatusDocument {
  const kind = (raw as { kind?: unknown } | null)?.kind;
  return kind === 'active' || kind === 'blocked';
}

/**
 * Checked, never cast: a registered document without a readable status is
 * malformed, and every reader hears that as a failed Result — a live
 * listener must not throw a TypeError, and a server write that carries the
 * status forward must refuse rather than guess `active`.
 */
export function accountStatusFromDocument(
  raw: unknown,
): Result<AccountStatus, RepositoryError> {
  if (!isAccountStatusDocument(raw)) {
    return fail(new RepositoryError('Malformed user document: bad status'));
  }
  if (raw.kind === 'active') {
    return ok(AccountStatus.active());
  }
  const reasonResult = parseBlockReason(
    typeof raw.reason === 'string' ? raw.reason : '',
  );
  if (reasonResult.isFailure()) {
    return fail(
      new RepositoryError(
        'Malformed user document: bad block reason',
        reasonResult.error,
      ),
    );
  }
  let until: ZonedDateTime | undefined;
  if (raw.untilIso) {
    const untilResult = ZonedDateTime.fromISO(raw.untilIso, STATUS_ZONE);
    if (untilResult.isFailure()) {
      return fail(
        new RepositoryError(
          'Malformed user document: bad block until',
          untilResult.error,
        ),
      );
    }
    until = untilResult.value;
  }
  const reason: BlockReason = reasonResult.value;
  return ok(
    AccountStatus.blocked({ reason, ...(until !== undefined && { until }) }),
  );
}
