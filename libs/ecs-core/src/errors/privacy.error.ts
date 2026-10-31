/**
 * The data-subject requests' error codes (audit-hardening Phase 3, WS-C /
 * WS-D) — the refusals of the admin-only privacy callables (the client
 * export, `exportClientData`; the erasure's preview and act,
 * `previewClientErasure` and `eraseClient`), one dictionary of flat
 * structs discriminated by `errorCode` (Law 7.5), SCREAMING_SNAKE with the
 * `PRIVACY_` prefix. The UI looks them up as
 * `errors.<errorCode>`; the edge sends the code itself on the wire. Every
 * field beside `errorCode` is a scalar — a payload field's NAME or a count,
 * never a value of the person the request is about (R36 / T5).
 *
 * The wire status of each (the functions' `PRIVACY_WIRE` table) is noted on
 * its member.
 */
export const PrivacyErrorCode = {
  /** No signed-in caller (`unauthenticated`), refused before the payload is read. */
  Unauthenticated: 'PRIVACY_UNAUTHENTICATED',
  /**
   * The caller is not the shop's admin (`permission-denied`) — its token
   * claims, or its STORED roles re-read by the pipeline, hold no role of
   * `Roles.PRIVACY` (the sysadmin is not enough).
   */
  Forbidden: 'PRIVACY_FORBIDDEN',
  /** A payload field missing or malformed (`invalid-argument`); `field` names it. */
  InvalidInput: 'PRIVACY_INVALID_INPUT',
  /** The `client.privacy` flag is off for this deployment (`failed-precondition`). */
  Unavailable: 'PRIVACY_UNAVAILABLE',
  /** No client record under the requested id (`not-found`). */
  ClientNotFound: 'PRIVACY_CLIENT_NOT_FOUND',
  /**
   * The person's data is past the export's cap (`failed-precondition`) —
   * refused whole, never truncated; the counts say how far it reached.
   */
  ExportTooLarge: 'PRIVACY_EXPORT_TOO_LARGE',
  /**
   * The record links an account the shop must not erase from here
   * (`failed-precondition`): a staff role in its STORED account or in its
   * Auth custom claims, or — fail-closed, P3-DEP-29 — a linked uid with no
   * `users` document while its Auth user exists. No production path sets
   * custom claims, so without the document nothing proves the account
   * belongs to no operator (P3-L-16; `ClientErasureSystem.refusalOf`). An
   * erasure would remove an operator.
   */
  ErasureStaffAccount: 'PRIVACY_ERASURE_STAFF_ACCOUNT',
  /**
   * The record's `userId` is no PROVABLE link (`failed-precondition`):
   * `record.id !== CustomerId.forUser(record.userId, hash)`, the D29
   * invariant every account-holder record is created under — refused by
   * every privacy callable before any read keyed by that uid, so a corrupt
   * link never exports or erases another account (P3-L-9, P3-RU-37 (h);
   * `ClientPrivacySystem.linkOf` is the one check).
   */
  AccountLinkMismatch: 'PRIVACY_ACCOUNT_LINK_MISMATCH',
  /**
   * A footprint list past the erasure's cap (`failed-precondition`) —
   * refused before any write, never a silent truncation (P3-L-21); the
   * count says how far the list reached.
   */
  ErasureTooLarge: 'PRIVACY_ERASURE_TOO_LARGE',
} as const;
export type PrivacyErrorCode =
  (typeof PrivacyErrorCode)[keyof typeof PrivacyErrorCode];

export type PrivacyError =
  | PrivacyError.Unauthenticated
  | PrivacyError.Forbidden
  | PrivacyError.InvalidInput
  | PrivacyError.Unavailable
  | PrivacyError.ClientNotFound
  | PrivacyError.ExportTooLarge
  | PrivacyError.ErasureStaffAccount
  | PrivacyError.AccountLinkMismatch
  | PrivacyError.ErasureTooLarge;

export const PrivacyError = {
  unauthenticated(): PrivacyError.Unauthenticated {
    return { errorCode: PrivacyErrorCode.Unauthenticated };
  },
  forbidden(): PrivacyError.Forbidden {
    return { errorCode: PrivacyErrorCode.Forbidden };
  },
  invalidInput(field: PrivacyError.InputField): PrivacyError.InvalidInput {
    return { errorCode: PrivacyErrorCode.InvalidInput, field };
  },
  unavailable(): PrivacyError.Unavailable {
    return { errorCode: PrivacyErrorCode.Unavailable };
  },
  clientNotFound(): PrivacyError.ClientNotFound {
    return { errorCode: PrivacyErrorCode.ClientNotFound };
  },
  exportTooLarge(
    exportDocumentCount: number,
    exportByteCount: number,
  ): PrivacyError.ExportTooLarge {
    return {
      errorCode: PrivacyErrorCode.ExportTooLarge,
      exportDocumentCount,
      exportByteCount,
    };
  },
  erasureStaffAccount(): PrivacyError.ErasureStaffAccount {
    return { errorCode: PrivacyErrorCode.ErasureStaffAccount };
  },
  accountLinkMismatch(): PrivacyError.AccountLinkMismatch {
    return { errorCode: PrivacyErrorCode.AccountLinkMismatch };
  },
  erasureTooLarge(erasureListedCount: number): PrivacyError.ErasureTooLarge {
    return { errorCode: PrivacyErrorCode.ErasureTooLarge, erasureListedCount };
  },

  /** Narrows an error to one code — `PrivacyError.is(e, PrivacyErrorCode.ExportTooLarge)`. */
  is<C extends PrivacyErrorCode>(
    error: PrivacyError,
    errorCode: C,
  ): error is Extract<PrivacyError, { readonly errorCode: C }> {
    return error.errorCode === errorCode;
  },
} as const;

export namespace PrivacyError {
  /** The payload fields a privacy call carries — the one an `InvalidInput` names. */
  export type InputField = 'customerId' | 'operationId';

  export type Unauthenticated = {
    readonly errorCode: typeof PrivacyErrorCode.Unauthenticated;
  };
  export type Forbidden = {
    readonly errorCode: typeof PrivacyErrorCode.Forbidden;
  };
  export type InvalidInput = {
    readonly errorCode: typeof PrivacyErrorCode.InvalidInput;
    /** The payload field that was missing or malformed. */
    readonly field: InputField;
  };
  export type Unavailable = {
    readonly errorCode: typeof PrivacyErrorCode.Unavailable;
  };
  export type ClientNotFound = {
    readonly errorCode: typeof PrivacyErrorCode.ClientNotFound;
  };
  export type ExportTooLarge = {
    readonly errorCode: typeof PrivacyErrorCode.ExportTooLarge;
    /** How many documents the export reached (audit rows included). */
    readonly exportDocumentCount: number;
    /** How many UTF-8 bytes of canonical JSON it measured (none when the document cap refused first). */
    readonly exportByteCount: number;
  };
  export type ErasureStaffAccount = {
    readonly errorCode: typeof PrivacyErrorCode.ErasureStaffAccount;
  };
  /** No uid, no id: the admin knows which record they asked for; a uid on the wire would name the account. */
  export type AccountLinkMismatch = {
    readonly errorCode: typeof PrivacyErrorCode.AccountLinkMismatch;
  };
  export type ErasureTooLarge = {
    readonly errorCode: typeof PrivacyErrorCode.ErasureTooLarge;
    /** How many documents the list that passed the cap returned (the cap and one). */
    readonly erasureListedCount: number;
  };
}
