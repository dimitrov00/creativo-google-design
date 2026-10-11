/**
 * Why a call into a pipeline from the other side of a boundary failed — the
 * `E` of the web's `callableClient` (`Promise<Result<Out, PipelineError>>`)
 * and of the outbound side-channel ports (`SendOtp`). One taxonomy in place
 * of the four duck-typed gateway copies (`BookingGatewayFailureCode`,
 * `WaitlistGatewayCode`, `OtpClientError`, `OtpSendError`), coarse on
 * purpose: each code names what the caller DOES next.
 *
 * The server's own domain code rides along as `serverErrorCode` (with the reason
 * one level down, `refusal` or `field`), so the UI can word the specific case
 * — tried `<serverErrorCode>.<refusal|field>`, then `<serverErrorCode>`, then
 * `errorCode` — while the flow branches on `errorCode` alone. Every
 * non-`errorCode` field is an i18n
 * parameter: a scalar or `null`.
 */

/** Error codes — the ONLY source of these strings; the UI translates them. */
export const PipelineErrorCode = {
  /** Nobody (or not this person) is signed in — the next step is sign-in. */
  Unauthenticated: 'PIPELINE_UNAUTHENTICATED',
  /** The time shown was taken meanwhile — re-pick from a fresh grid. */
  SlotUnavailable: 'PIPELINE_SLOT_UNAVAILABLE',
  /** A service changed or left the catalog under the request. */
  CatalogChanged: 'PIPELINE_CATALOG_CHANGED',
  /** Refused as sent; repeating the same request cannot succeed. */
  InvalidRequest: 'PIPELINE_INVALID_REQUEST',
  /** Transient (network, store, delivery) — the same call later is the fix. */
  Unavailable: 'PIPELINE_UNAVAILABLE',
  /** Anything the other side did not classify. */
  Unknown: 'PIPELINE_UNKNOWN',
} as const;
export type PipelineErrorCode =
  (typeof PipelineErrorCode)[keyof typeof PipelineErrorCode];

/** One shape for every code, so every error shares one hidden class. */
export type PipelineError = {
  readonly errorCode: PipelineErrorCode;
  /** The server's dotted domain code (`booking.commit.slot_unavailable`), if any. */
  readonly serverErrorCode: string | null;
  /** The reason one level down a refusal names (`barber_unavailable`), if any. */
  readonly refusal: string | null;
  /** The input field an invalid request names, if any. */
  readonly field: string | null;
};

export const PipelineError = {
  of(
    errorCode: PipelineErrorCode,
    serverErrorCode: string | null,
    refusal: string | null,
    field: string | null,
  ): PipelineError {
    return { errorCode, serverErrorCode, refusal, field };
  },

  /** A failure with nothing more specific to say than its code. */
  bare(errorCode: PipelineErrorCode): PipelineError {
    return { errorCode, serverErrorCode: null, refusal: null, field: null };
  },

  is(error: PipelineError, code: PipelineErrorCode): boolean {
    return error.errorCode === code;
  },
} as const;
