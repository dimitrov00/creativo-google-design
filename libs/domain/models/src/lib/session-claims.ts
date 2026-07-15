import { Result, fail, ok } from '@creativo/domain/kernel';
import { InvalidClaimsError } from './session-claims.errors';
import { Role, isRole } from './role';

/**
 * Decodes the custom claims (`tenantId`, `role`) minted onto a Firebase ID
 * token by `admin.auth().createCustomToken()` — replaces the previous
 * Zod-based `CustomClaimsSchema`. Constructed from an untrusted `unknown`
 * (the raw `ParsedToken` off the SDK), never trusted without validation.
 */
export class SessionClaims {
  private constructor(
    private readonly _tenantId: string,
    private readonly _role: Role,
  ) {}

  static fromToken(claims: unknown): Result<SessionClaims, InvalidClaimsError> {
    if (typeof claims !== 'object' || claims === null) {
      return fail(new InvalidClaimsError('claims payload is not an object'));
    }

    const tenantId = (claims as Record<string, unknown>)['tenantId'];
    if (typeof tenantId !== 'string' || tenantId.trim().length === 0) {
      return fail(new InvalidClaimsError('missing or empty tenantId'));
    }

    const role = (claims as Record<string, unknown>)['role'];
    if (!isRole(role)) {
      return fail(new InvalidClaimsError(`unknown role: ${String(role)}`));
    }

    return ok(new SessionClaims(tenantId, role));
  }

  get tenantId(): string {
    return this._tenantId;
  }

  get role(): Role {
    return this._role;
  }

  hasRole(...roles: Role[]): boolean {
    return roles.includes(this._role);
  }
}
