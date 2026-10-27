/**
 * The data-subject requests' error codes (audit-hardening Phase 3, WS-C /
 * WS-D) — the refusals of the admin-only privacy callables (the client
 * export, `exportClientData`; the erasure adds its own codes here), one
 * dictionary of flat structs discriminated by `errorCode` (Law 7.5),
 * SCREAMING_SNAKE with the `PRIVACY_` prefix. The UI looks them up as
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
} as const;
export type PrivacyErrorCode =
  (typeof PrivacyErrorCode)[keyof typeof PrivacyErrorCode];

export type PrivacyError =
  | PrivacyError.Unauthenticated
  | PrivacyError.Forbidden
  | PrivacyError.InvalidInput
  | PrivacyError.Unavailable
  | PrivacyError.ClientNotFound
  | PrivacyError.ExportTooLarge;

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
}
