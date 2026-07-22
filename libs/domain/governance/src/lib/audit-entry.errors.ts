import { DomainError, InvalidDateTimeError } from '@creativo/domain/kernel';
import { EmptyIdError as AccountsEmptyIdError } from '@creativo/domain/accounts';
import { EmptyIdError } from './ids.errors';

export class EmptyAuditActionError extends DomainError {
  override readonly code = 'governance.audit_entry.empty_action' as const;
  constructor() {
    super('An audit entry requires a non-empty action code');
  }
}

/**
 * `AuditEntryId.create` fails with this context's own `EmptyIdError`
 * (`governance.id.empty`); `UserId.create` (for `targetUserId`) fails
 * with the ACCOUNTS context's own `EmptyIdError` (`accounts.id.empty`) —
 * same class name, deliberately different types (each context mints its
 * own id-brand family, see `ids.errors.ts`), so both appear here.
 */
export type AuditEntryValidationError =
  | EmptyIdError
  | AccountsEmptyIdError
  | EmptyAuditActionError
  | InvalidDateTimeError;
