import { Result, StoredFields, Tag, UserId } from '@core/primitives';
import { type PipelineError } from '@core/errors';
import { CallAnswer } from './call-answer.data';
import { Role } from './role.data';

/**
 * THE ROLES-CHANGE WIRE (security hardening S-WS-E) — `setRoles`: whose
 * roles an admin sets, and the whole new set (from the closed `Role`
 * dictionary). The server adds the caller; the act's transport operation id
 * rides the payload (`OPERATION_ID_FIELD`), the impersonation calls' idiom.
 */
export type RolesCall = {
  readonly targetUserId: UserId;
  readonly roles: readonly Role[];
};

export const RolesCall = {
  /**
   * `setRoles`' answer, read through `CallAnswer` like every answer: the
   * account, its stored set after the call — each entry a known role, else
   * the answer is unusable — and whether anything was written. An answer
   * with nothing usable in it is `PIPELINE_UNKNOWN`.
   */
  decodeChanged(raw: unknown): Result<RolesCall.Changed, PipelineError> {
    const answer = CallAnswer.read(raw);
    if (answer === null) return CallAnswer.unusable();
    const targetUserId = CallAnswer.parsed(
      answer,
      'targetUserId',
      UserId.parse,
    );
    const roles = rolesOf(StoredFields.field(answer, 'roles'));
    const rolesChanged = CallAnswer.flag(answer, 'rolesChanged');
    return targetUserId === null || roles === null || rolesChanged === null
      ? CallAnswer.unusable()
      : Result.ok({ targetUserId, roles, rolesChanged });
  },
} as const;

/** A list of roles, each a value of the `Role` dictionary — `null` when it is no array or any entry is not a role. */
function rolesOf(raw: unknown): readonly Role[] | null {
  if (!Array.isArray(raw)) return null;
  const out: Role[] = [];
  for (const value of raw as readonly unknown[]) {
    if (!Tag.has(Role, value)) return null;
    out.push(value);
  }
  return out;
}

export namespace RolesCall {
  /** `setRoles`' answer. */
  export type Changed = {
    readonly targetUserId: UserId;
    /** The stored set after the call, dictionary order. */
    readonly roles: readonly Role[];
    /** `false`: the set was already this — nothing was written (the sessions were still revoked). */
    readonly rolesChanged: boolean;
  };
}
