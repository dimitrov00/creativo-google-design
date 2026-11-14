import type { StaffCapability } from '@core/primitives';

/**
 * Why a staff callable refused its caller (`docs/designs/staff-permissions.md`,
 * P6) — the ONE vocabulary every converted callable answers, in place of
 * each domain's own "forbidden" code. Flat structs discriminated by
 * `errorCode` (Law 7.5), SCREAMING_SNAKE with the `ACCESS_` prefix; the
 * screen words each as `errors.<errorCode>` with the capability's label set
 * in. All three leave as `permission-denied`.
 *
 * `StaffAccessSystem.admit` decides them on the caller's STORED account and
 * the owner's cells (`settings/staffPermissions`), inside the callable's own
 * read. A call with no session keeps its domain's `*_UNAUTHENTICATED` code.
 */
export const AccessErrorCode = {
  /**
   * The caller is no staff member as of the call: no account document, a
   * blocked or erased account, or a role set that holds no staff role —
   * whatever their token still claims.
   */
  NotStaff: 'ACCESS_NOT_STAFF',
  /** None of the caller's levels has this capability. */
  Denied: 'ACCESS_DENIED',
  /**
   * The caller has the capability for their own barber record only, and the
   * call reached past it: a colleague, the shop, or nobody the account is
   * linked to.
   */
  OwnOnly: 'ACCESS_OWN_ONLY',
} as const;
export type AccessErrorCode =
  (typeof AccessErrorCode)[keyof typeof AccessErrorCode];

export type AccessError =
  AccessError.NotStaff | AccessError.Denied | AccessError.OwnOnly;

/** The one struct every non-staff caller is answered — it carries nothing. */
const NOT_STAFF: AccessError.NotStaff = {
  errorCode: AccessErrorCode.NotStaff,
};

export const AccessError = {
  notStaff(): AccessError.NotStaff {
    return NOT_STAFF;
  },
  denied(staffCapability: StaffCapability): AccessError.Denied {
    return { errorCode: AccessErrorCode.Denied, staffCapability };
  },
  ownOnly(staffCapability: StaffCapability): AccessError.OwnOnly {
    return { errorCode: AccessErrorCode.OwnOnly, staffCapability };
  },
} as const;

export namespace AccessError {
  export type NotStaff = {
    readonly errorCode: typeof AccessErrorCode.NotStaff;
  };
  export type Denied = {
    readonly errorCode: typeof AccessErrorCode.Denied;
    /** The capability the caller lacks — the web names it in the refusal. */
    readonly staffCapability: StaffCapability;
  };
  export type OwnOnly = {
    readonly errorCode: typeof AccessErrorCode.OwnOnly;
    /** The capability the caller holds for their own record only. */
    readonly staffCapability: StaffCapability;
  };
}
