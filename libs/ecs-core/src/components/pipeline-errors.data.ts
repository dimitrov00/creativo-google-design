/**
 * Why a call into a pipeline from the other side of a boundary failed — the
 * `E` of the web's `callableClient` (`Promise<Result<Out, PipelineError>>`)
 * and of the outbound side-channel ports (`SendOtp`). One taxonomy in place
 * of the four duck-typed gateway copies (`BookingGatewayFailureCode`,
 * `WaitlistGatewayCode`, `OtpClientError`, `OtpSendError`), coarse on
 * purpose: each code names what the caller DOES next.
 *
 * The server's own domain code rides along as `serverCode` (with the reason
 * one level down, `refusal` or `field`), so the UI can word the specific case
 * — tried `<serverCode>.<refusal|field>`, then `<serverCode>`, then `code` —
 * while the flow branches on `code` alone. Every non-`code` field is an i18n
 * parameter: a scalar or `null`.
 */

/** Error codes — the ONLY source of these strings; the UI translates them. */
export const PipelineErrorCode = {
  /** Nobody (or not this person) is signed in — the next step is sign-in. */
  Unauthenticated: 'pipeline.unauthenticated',
  /** The time shown was taken meanwhile — re-pick from a fresh grid. */
  SlotUnavailable: 'pipeline.slot_unavailable',
  /** A service changed or left the catalog under the request. */
  CatalogChanged: 'pipeline.catalog_changed',
  /** Refused as sent; repeating the same request cannot succeed. */
  InvalidRequest: 'pipeline.invalid_request',
  /** Transient (network, store, delivery) — the same call later is the fix. */
  Unavailable: 'pipeline.unavailable',
  /** Anything the other side did not classify. */
  Unknown: 'pipeline.unknown',
} as const;
export type PipelineErrorCode =
  (typeof PipelineErrorCode)[keyof typeof PipelineErrorCode];

/** One shape for every code, so every error shares one hidden class. */
export type PipelineError = {
  readonly code: PipelineErrorCode;
  /** The server's dotted domain code (`booking.commit.slot_unavailable`), if any. */
  readonly serverCode: string | null;
  /** The reason one level down a refusal names (`barber_unavailable`), if any. */
  readonly refusal: string | null;
  /** The input field an invalid request names, if any. */
  readonly field: string | null;
};

export const PipelineError = {
  of(
    code: PipelineErrorCode,
    serverCode: string | null,
    refusal: string | null,
    field: string | null,
  ): PipelineError {
    return { code, serverCode, refusal, field };
  },

  /** A failure with nothing more specific to say than its code. */
  bare(code: PipelineErrorCode): PipelineError {
    return { code, serverCode: null, refusal: null, field: null };
  },

  is(error: PipelineError, code: PipelineErrorCode): boolean {
    return error.code === code;
  },
} as const;
