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

/**
 * The Firebase Auth UID a `Principal` is derived from. Deliberately its own
 * branded type rather than reusing accounts' `UserId` — the identity
 * bounded context establishes the auth-layer principal BEFORE a `User`
 * profile necessarily exists (see the auth/onboarding split), so `Principal`
 * should not structurally depend on the accounts context's id.
 */
export class PrincipalId extends Id<'Principal'> {
  private constructor(value: string) {
    super(value);
  }
  static create(raw: string): Result<PrincipalId, EmptyIdError> {
    return createId('PrincipalId', raw, (v) => new PrincipalId(v));
  }
  static generate(): PrincipalId {
    return new PrincipalId(crypto.randomUUID());
  }
}

export class OtpId extends Id<'Otp'> {
  private constructor(value: string) {
    super(value);
  }
  static create(raw: string): Result<OtpId, EmptyIdError> {
    return createId('OtpId', raw, (v) => new OtpId(v));
  }
  static generate(): OtpId {
    return new OtpId(crypto.randomUUID());
  }
}
