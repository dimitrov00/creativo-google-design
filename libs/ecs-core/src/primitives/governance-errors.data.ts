import type { ImpersonationSessionId, UserId } from './ids.primitive';

/**
 * The governance context's error codes — the codes of the legacy
 * governance domain lib's `*.errors.ts` (deleted in Phase 4b) and of the
 * governance use
 * cases (`end-impersonation.errors.ts`, `search-users.errors.ts`), collapsed
 * from `DomainError` subclasses into one dictionary of flat structs
 * discriminated by `errorCode` (Law 7.5), SCREAMING_SNAKE with the
 * `GOVERNANCE_` prefix (flatten-spec §4.2). Every non-`errorCode` field is
 * an i18n parameter, so each one is an i18n-safe scalar (infrastructure Q5).
 *
 * Not here: the tenant-config, locale and currency codes (a deployment
 * constant, `isLocale`, and `MONEY_UNKNOWN_CURRENCY` now) and the
 * repository failures (`repository-errors.data.ts`).
 */
export const GovernanceErrorCode = {
  /** An audit row with a blank action. */
  AuditEntryEmptyAction: 'GOVERNANCE_AUDIT_ENTRY_EMPTY_ACTION',
  /** A flags bag carrying a key outside the `FlagName` dictionary. */
  FeatureFlagsUnknownKey: 'GOVERNANCE_FEATURE_FLAGS_UNKNOWN_KEY',
  /** A flags bag carrying a non-boolean value. */
  FeatureFlagsInvalidValue: 'GOVERNANCE_FEATURE_FLAGS_INVALID_VALUE',
  /** A scope outside the `ImpersonationScope` dictionary. */
  ImpersonationScopeInvalid: 'GOVERNANCE_IMPERSONATION_SCOPE_INVALID',
  /** An admin cannot impersonate themselves. */
  ImpersonationSelf: 'GOVERNANCE_IMPERSONATION_SESSION_SELF_IMPERSONATION',
  /** Every session demands a recorded justification. */
  ImpersonationReasonRequired:
    'GOVERNANCE_IMPERSONATION_SESSION_REASON_REQUIRED',
  /** `expiresAtUtcMs` not strictly after `startedAtUtcMs`. */
  ImpersonationInvalidExpiry: 'GOVERNANCE_IMPERSONATION_SESSION_INVALID_EXPIRY',
  /** Only a staff role set may start a session. */
  ImpersonationAdminNotStaff:
    'GOVERNANCE_IMPERSONATION_SESSION_ADMIN_NOT_STAFF',
  /** The session was already ended — the first end wins. */
  ImpersonationAlreadyEnded: 'GOVERNANCE_IMPERSONATION_SESSION_ALREADY_ENDED',
  /** No such `impersonationSessions/{id}` to end. */
  EndImpersonationNotFound: 'GOVERNANCE_END_IMPERSONATION_NOT_FOUND',
  /** A user search shorter than `minLength`. */
  SearchUsersQueryTooShort: 'GOVERNANCE_SEARCH_USERS_QUERY_TOO_SHORT',
  /** `startImpersonation` / `endImpersonation` called without a signed-in session. */
  ImpersonationUnauthenticated: 'GOVERNANCE_IMPERSONATION_UNAUTHENTICATED',
  /**
   * The caller holds no admin role (`ADMIN_ROLES`) — today's rule
   * `isAdmin()` on `impersonationSessions`; checked before any read.
   */
  ImpersonationForbidden: 'GOVERNANCE_IMPERSONATION_FORBIDDEN',
} as const;
export type GovernanceErrorCode =
  (typeof GovernanceErrorCode)[keyof typeof GovernanceErrorCode];

export type GovernanceError =
  | GovernanceError.AuditEntryEmptyAction
  | GovernanceError.FeatureFlagsUnknownKey
  | GovernanceError.FeatureFlagsInvalidValue
  | GovernanceError.ImpersonationScopeInvalid
  | GovernanceError.ImpersonationSelf
  | GovernanceError.ImpersonationReasonRequired
  | GovernanceError.ImpersonationInvalidExpiry
  | GovernanceError.ImpersonationAdminNotStaff
  | GovernanceError.ImpersonationAlreadyEnded
  | GovernanceError.EndImpersonationNotFound
  | GovernanceError.SearchUsersQueryTooShort
  | GovernanceError.ImpersonationUnauthenticated
  | GovernanceError.ImpersonationForbidden;

export const GovernanceError = {
  auditEntryEmptyAction(): GovernanceError.AuditEntryEmptyAction {
    return { errorCode: GovernanceErrorCode.AuditEntryEmptyAction };
  },
  featureFlagsUnknownKey(
    attempted: string,
  ): GovernanceError.FeatureFlagsUnknownKey {
    return { errorCode: GovernanceErrorCode.FeatureFlagsUnknownKey, attempted };
  },
  featureFlagsInvalidValue(
    key: string,
  ): GovernanceError.FeatureFlagsInvalidValue {
    return { errorCode: GovernanceErrorCode.FeatureFlagsInvalidValue, key };
  },
  impersonationScopeInvalid(
    attempted: string,
  ): GovernanceError.ImpersonationScopeInvalid {
    return {
      errorCode: GovernanceErrorCode.ImpersonationScopeInvalid,
      attempted,
    };
  },
  impersonationSelf(): GovernanceError.ImpersonationSelf {
    return { errorCode: GovernanceErrorCode.ImpersonationSelf };
  },
  impersonationReasonRequired(): GovernanceError.ImpersonationReasonRequired {
    return { errorCode: GovernanceErrorCode.ImpersonationReasonRequired };
  },
  impersonationInvalidExpiry(): GovernanceError.ImpersonationInvalidExpiry {
    return { errorCode: GovernanceErrorCode.ImpersonationInvalidExpiry };
  },
  impersonationAdminNotStaff(
    adminUserId: UserId,
  ): GovernanceError.ImpersonationAdminNotStaff {
    return {
      errorCode: GovernanceErrorCode.ImpersonationAdminNotStaff,
      adminUserId,
    };
  },
  impersonationAlreadyEnded(
    sessionId: ImpersonationSessionId,
  ): GovernanceError.ImpersonationAlreadyEnded {
    return {
      errorCode: GovernanceErrorCode.ImpersonationAlreadyEnded,
      sessionId,
    };
  },
  endImpersonationNotFound(
    sessionId: ImpersonationSessionId,
  ): GovernanceError.EndImpersonationNotFound {
    return {
      errorCode: GovernanceErrorCode.EndImpersonationNotFound,
      sessionId,
    };
  },
  searchUsersQueryTooShort(
    minLength: number,
  ): GovernanceError.SearchUsersQueryTooShort {
    return {
      errorCode: GovernanceErrorCode.SearchUsersQueryTooShort,
      minLength,
    };
  },
  impersonationUnauthenticated(): GovernanceError.ImpersonationUnauthenticated {
    return { errorCode: GovernanceErrorCode.ImpersonationUnauthenticated };
  },
  impersonationForbidden(
    callerUserId: UserId,
  ): GovernanceError.ImpersonationForbidden {
    return {
      errorCode: GovernanceErrorCode.ImpersonationForbidden,
      callerUserId,
    };
  },

  /** Narrows an error to one code — `GovernanceError.is(e, GovernanceErrorCode.ImpersonationSelf)`. */
  is<C extends GovernanceErrorCode>(
    error: GovernanceError,
    errorCode: C,
  ): error is Extract<GovernanceError, { readonly errorCode: C }> {
    return error.errorCode === errorCode;
  },
} as const;

export namespace GovernanceError {
  export type AuditEntryEmptyAction = {
    readonly errorCode: typeof GovernanceErrorCode.AuditEntryEmptyAction;
  };
  export type FeatureFlagsUnknownKey = {
    readonly errorCode: typeof GovernanceErrorCode.FeatureFlagsUnknownKey;
    readonly attempted: string;
  };
  export type FeatureFlagsInvalidValue = {
    readonly errorCode: typeof GovernanceErrorCode.FeatureFlagsInvalidValue;
    readonly key: string;
  };
  export type ImpersonationScopeInvalid = {
    readonly errorCode: typeof GovernanceErrorCode.ImpersonationScopeInvalid;
    readonly attempted: string;
  };
  export type ImpersonationSelf = {
    readonly errorCode: typeof GovernanceErrorCode.ImpersonationSelf;
  };
  export type ImpersonationReasonRequired = {
    readonly errorCode: typeof GovernanceErrorCode.ImpersonationReasonRequired;
  };
  export type ImpersonationInvalidExpiry = {
    readonly errorCode: typeof GovernanceErrorCode.ImpersonationInvalidExpiry;
  };
  export type ImpersonationAdminNotStaff = {
    readonly errorCode: typeof GovernanceErrorCode.ImpersonationAdminNotStaff;
    readonly adminUserId: UserId;
  };
  export type ImpersonationAlreadyEnded = {
    readonly errorCode: typeof GovernanceErrorCode.ImpersonationAlreadyEnded;
    readonly sessionId: ImpersonationSessionId;
  };
  export type EndImpersonationNotFound = {
    readonly errorCode: typeof GovernanceErrorCode.EndImpersonationNotFound;
    readonly sessionId: ImpersonationSessionId;
  };
  export type SearchUsersQueryTooShort = {
    readonly errorCode: typeof GovernanceErrorCode.SearchUsersQueryTooShort;
    readonly minLength: number;
  };
  export type ImpersonationUnauthenticated = {
    readonly errorCode: typeof GovernanceErrorCode.ImpersonationUnauthenticated;
  };
  export type ImpersonationForbidden = {
    readonly errorCode: typeof GovernanceErrorCode.ImpersonationForbidden;
    /** The signed-in caller whose roles hold no admin role. */
    readonly callerUserId: UserId;
  };
}

/** Why the operator backfill (`runBackfill`) refused a call — the ONLY source of these strings, the field `errorCode`. */
export const RunBackfillRefusalCode = {
  /** No signed-in caller (was the wire's `ops.backfill.unauthenticated`). */
  Unauthenticated: 'OPS_BACKFILL_UNAUTHENTICATED',
  /** The stored roles hold no `sysadmin`. */
  Forbidden: 'OPS_BACKFILL_FORBIDDEN',
  /** The payload named no job, or a cursor that is not a document id. */
  InvalidInput: 'OPS_BACKFILL_INVALID_INPUT',
} as const;
export type RunBackfillRefusalCode =
  (typeof RunBackfillRefusalCode)[keyof typeof RunBackfillRefusalCode];

export type RunBackfillRefusal = { readonly errorCode: RunBackfillRefusalCode };
