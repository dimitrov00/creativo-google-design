import { BarberId, Result, StoredFields, Tag, UserId } from '@core/primitives';
import { type PipelineError } from '@core/errors';
import { CallAnswer } from './call-answer.data';
import { Role } from './role.data';
import type { StaffLink } from './staff-link.data';

/**
 * What a `setRoles` call asks of the account's barber link (staff
 * analytics, "Which barber the caller is") — the ONLY source of these
 * strings, the field `barberLinkChange`. On the wire an absent field is
 * `KEEP`, so a client that knows nothing of links never unlinks anyone.
 */
export const BarberLinkChange = {
  /** Leave the link as stored (`barberLinkChange` absent on the wire). */
  Keep: 'KEEP',
  /** Link the account to `linkedBarberId` (a new link, or a relink). */
  Set: 'SET',
  /** Release the link: the account is "barber, not linked". */
  Clear: 'CLEAR',
} as const;
export type BarberLinkChange =
  (typeof BarberLinkChange)[keyof typeof BarberLinkChange];

/**
 * The link half of a roles call — flat variants on `barberLinkChange`; the
 * barber record is named only by `SET` (`null` beside the other two, so
 * every call shares one shape).
 */
export type BarberLinkRequest =
  BarberLinkRequest.Keep | BarberLinkRequest.Set | BarberLinkRequest.Clear;

const KEEP: BarberLinkRequest.Keep = {
  barberLinkChange: BarberLinkChange.Keep,
  linkedBarberId: null,
};
const CLEAR: BarberLinkRequest.Clear = {
  barberLinkChange: BarberLinkChange.Clear,
  linkedBarberId: null,
};

export const BarberLinkRequest = {
  /** Leave the link as stored — what every call that does not touch it sends. */
  KEEP,
  /** Release the link. */
  CLEAR,
  /** Link the account to `barberId`. */
  set(barberId: BarberId): BarberLinkRequest.Set {
    return { barberLinkChange: BarberLinkChange.Set, linkedBarberId: barberId };
  },
} as const;

export namespace BarberLinkRequest {
  export type Keep = {
    readonly barberLinkChange: typeof BarberLinkChange.Keep;
    readonly linkedBarberId: null;
  };
  export type Set = {
    readonly barberLinkChange: typeof BarberLinkChange.Set;
    /** The barber record the account is to be. */
    readonly linkedBarberId: BarberId;
  };
  export type Clear = {
    readonly barberLinkChange: typeof BarberLinkChange.Clear;
    readonly linkedBarberId: null;
  };
}

/**
 * THE ROLES-CHANGE WIRE (security hardening S-WS-E) — `setRoles`: whose
 * roles an admin sets, the whole new set (from the closed `Role`
 * dictionary) and what becomes of the account's barber link
 * ({@link BarberLinkRequest}). The server adds the caller; the act's
 * transport operation id rides the payload (`OPERATION_ID_FIELD`), the
 * impersonation calls' idiom.
 */
export type RolesCall = RolesCallMeta & BarberLinkRequest;

/** The account and its whole new role set. */
export type RolesCallMeta = {
  readonly targetUserId: UserId;
  readonly roles: readonly Role[];
};

export const RolesCall = {
  /**
   * `setRoles`' answer, read through `CallAnswer` like every answer: the
   * account, its stored set after the call — each entry a known role, else
   * the answer is unusable — whether the roles were written, the account's
   * barber link after the call (a barber id or `null`) and whether the link
   * was written. An answer with nothing usable in it is `PIPELINE_UNKNOWN`.
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
    const link = linkOf(StoredFields.field(answer, 'linkedBarberId'));
    const linkChanged = CallAnswer.flag(answer, 'linkChanged');
    return targetUserId === null ||
      roles === null ||
      rolesChanged === null ||
      link === null ||
      linkChanged === null
      ? CallAnswer.unusable()
      : Result.ok({
          targetUserId,
          roles,
          rolesChanged,
          linkedBarberId: link.linkedBarberId,
          linkChanged,
        });
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

/** The answer's link: a stored `null` or a barber id, boxed — `null` when it is neither (absent included). */
function linkOf(raw: unknown): StaffLink | null {
  if (raw === null) return { linkedBarberId: null };
  if (typeof raw !== 'string') return null;
  const parsed = BarberId.parse(raw);
  return parsed.ok ? { linkedBarberId: parsed.value } : null;
}

export namespace RolesCall {
  /** `setRoles`' answer. */
  export type Changed = {
    readonly targetUserId: UserId;
    /** The stored set after the call, dictionary order. */
    readonly roles: readonly Role[];
    /** `false`: the set was already this — the roles were not written (the sessions were still revoked). */
    readonly rolesChanged: boolean;
    /** The account's barber link after the call; `null` is "not linked". */
    readonly linkedBarberId: BarberId | null;
    /** `false`: the link was already this — nothing of it was written. */
    readonly linkChanged: boolean;
  };
}
