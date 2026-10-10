/**
 * The governance context's error codes — the dotted codes of
 * `libs/domain/governance/src/lib/*.errors.ts` and of the governance use
 * cases (`end-impersonation.errors.ts`, `search-users.errors.ts`), reused as
 * is, collapsed from `DomainError` subclasses into one dictionary of plain
 * structs (blueprint §2.4, §2.7). Every non-`code` field is an i18n
 * parameter, so each one is an i18n-safe scalar (infrastructure Q5).
 *
 * Not here: the tenant-config, locale and currency codes (a deployment
 * constant, `isLocale`, and `money.unknown_currency` now) and the
 * repository failures (`repository-errors.data.ts`).
 */
export const GovernanceErrorCode = {
  /** An audit row with a blank action. */
  AuditEntryEmptyAction: 'governance.audit_entry.empty_action',
  /** A flags bag carrying a key outside the `FlagName` dictionary. */
  FeatureFlagsUnknownKey: 'governance.feature_flags.unknown_key',
  /** A flags bag carrying a non-boolean value. */
  FeatureFlagsInvalidValue: 'governance.feature_flags.invalid_value',
  /** A scope outside the `ImpersonationScope` dictionary. */
  ImpersonationScopeInvalid: 'governance.impersonation_scope.invalid',
  /** An admin cannot impersonate themselves. */
  ImpersonationSelf: 'governance.impersonation_session.self_impersonation',
  /** Every session demands a recorded justification. */
  ImpersonationReasonRequired:
    'governance.impersonation_session.reason_required',
  /** `expiresAtMs` not strictly after `startedAtMs`. */
  ImpersonationInvalidExpiry: 'governance.impersonation_session.invalid_expiry',
  /** Only a staff role set may start a session. */
  ImpersonationAdminNotStaff:
    'governance.impersonation_session.admin_not_staff',
  /** The session was already ended — the first end wins. */
  ImpersonationAlreadyEnded: 'governance.impersonation_session.already_ended',
  /** No such `impersonationSessions/{id}` to end. */
  EndImpersonationNotFound: 'governance.end_impersonation.not_found',
  /** A user search shorter than `minLength`. */
  SearchUsersQueryTooShort: 'governance.search_users.query_too_short',
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
  | GovernanceError.SearchUsersQueryTooShort;

export const GovernanceError = {
  auditEntryEmptyAction(): GovernanceError.AuditEntryEmptyAction {
    return { code: GovernanceErrorCode.AuditEntryEmptyAction };
  },
  featureFlagsUnknownKey(
    attempted: string,
  ): GovernanceError.FeatureFlagsUnknownKey {
    return { code: GovernanceErrorCode.FeatureFlagsUnknownKey, attempted };
  },
  featureFlagsInvalidValue(
    key: string,
  ): GovernanceError.FeatureFlagsInvalidValue {
    return { code: GovernanceErrorCode.FeatureFlagsInvalidValue, key };
  },
  impersonationScopeInvalid(
    attempted: string,
  ): GovernanceError.ImpersonationScopeInvalid {
    return { code: GovernanceErrorCode.ImpersonationScopeInvalid, attempted };
  },
  impersonationSelf(): GovernanceError.ImpersonationSelf {
    return { code: GovernanceErrorCode.ImpersonationSelf };
  },
  impersonationReasonRequired(): GovernanceError.ImpersonationReasonRequired {
    return { code: GovernanceErrorCode.ImpersonationReasonRequired };
  },
  impersonationInvalidExpiry(): GovernanceError.ImpersonationInvalidExpiry {
    return { code: GovernanceErrorCode.ImpersonationInvalidExpiry };
  },
  impersonationAdminNotStaff(
    adminUserId: string,
  ): GovernanceError.ImpersonationAdminNotStaff {
    return {
      code: GovernanceErrorCode.ImpersonationAdminNotStaff,
      adminUserId,
    };
  },
  impersonationAlreadyEnded(
    sessionId: string,
  ): GovernanceError.ImpersonationAlreadyEnded {
    return { code: GovernanceErrorCode.ImpersonationAlreadyEnded, sessionId };
  },
  endImpersonationNotFound(
    sessionId: string,
  ): GovernanceError.EndImpersonationNotFound {
    return { code: GovernanceErrorCode.EndImpersonationNotFound, sessionId };
  },
  searchUsersQueryTooShort(
    minLength: number,
  ): GovernanceError.SearchUsersQueryTooShort {
    return { code: GovernanceErrorCode.SearchUsersQueryTooShort, minLength };
  },

  /** Narrows an error to one code — `GovernanceError.is(e, GovernanceErrorCode.ImpersonationSelf)`. */
  is<C extends GovernanceErrorCode>(
    error: GovernanceError,
    code: C,
  ): error is Extract<GovernanceError, { readonly code: C }> {
    return error.code === code;
  },
} as const;

export namespace GovernanceError {
  export type AuditEntryEmptyAction = {
    readonly code: typeof GovernanceErrorCode.AuditEntryEmptyAction;
  };
  export type FeatureFlagsUnknownKey = {
    readonly code: typeof GovernanceErrorCode.FeatureFlagsUnknownKey;
    readonly attempted: string;
  };
  export type FeatureFlagsInvalidValue = {
    readonly code: typeof GovernanceErrorCode.FeatureFlagsInvalidValue;
    readonly key: string;
  };
  export type ImpersonationScopeInvalid = {
    readonly code: typeof GovernanceErrorCode.ImpersonationScopeInvalid;
    readonly attempted: string;
  };
  export type ImpersonationSelf = {
    readonly code: typeof GovernanceErrorCode.ImpersonationSelf;
  };
  export type ImpersonationReasonRequired = {
    readonly code: typeof GovernanceErrorCode.ImpersonationReasonRequired;
  };
  export type ImpersonationInvalidExpiry = {
    readonly code: typeof GovernanceErrorCode.ImpersonationInvalidExpiry;
  };
  export type ImpersonationAdminNotStaff = {
    readonly code: typeof GovernanceErrorCode.ImpersonationAdminNotStaff;
    readonly adminUserId: string;
  };
  export type ImpersonationAlreadyEnded = {
    readonly code: typeof GovernanceErrorCode.ImpersonationAlreadyEnded;
    readonly sessionId: string;
  };
  export type EndImpersonationNotFound = {
    readonly code: typeof GovernanceErrorCode.EndImpersonationNotFound;
    readonly sessionId: string;
  };
  export type SearchUsersQueryTooShort = {
    readonly code: typeof GovernanceErrorCode.SearchUsersQueryTooShort;
    readonly minLength: number;
  };
}
