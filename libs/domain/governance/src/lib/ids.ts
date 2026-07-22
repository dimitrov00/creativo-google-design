import { Id, Result, fail, ok } from '@creativo/domain/kernel';
import { EmptyIdError } from './ids.errors';

function createId<T>(
  idType: string,
  raw: string,
  factory: (value: string) => T,
): Result<T, EmptyIdError> {
  if (raw.trim().length === 0) {
    return fail(new EmptyIdError(idType));
  }
  return ok(factory(raw));
}

/** Identifies one row of the append-only `AuditEntry` log. */
export class AuditEntryId extends Id<'AuditEntry'> {
  private constructor(value: string) {
    super(value);
  }

  static create(raw: string): Result<AuditEntryId, EmptyIdError> {
    return createId('AuditEntryId', raw, (v) => new AuditEntryId(v));
  }

  static generate(): AuditEntryId {
    return new AuditEntryId(crypto.randomUUID());
  }
}

/** Identifies one `ImpersonationSession`. */
export class ImpersonationSessionId extends Id<'ImpersonationSession'> {
  private constructor(value: string) {
    super(value);
  }

  static create(raw: string): Result<ImpersonationSessionId, EmptyIdError> {
    return createId(
      'ImpersonationSessionId',
      raw,
      (v) => new ImpersonationSessionId(v),
    );
  }

  static generate(): ImpersonationSessionId {
    return new ImpersonationSessionId(crypto.randomUUID());
  }
}
