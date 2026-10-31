import { AppCheckOutcome } from '@core/primitives';

/**
 * The App Check refusals (security hardening S-WS-A, S-RU-17, S-RU-24) —
 * answered by the callable edge only while the switch is ENFORCE
 * (`AppCheckSystem.verdictOf`), before the request is decoded. A flat
 * struct discriminated by `errorCode` (Law 7.5), SCREAMING_SNAKE with the
 * `APP_CHECK_` prefix; its one context field is the outcome tag — never
 * the token.
 *
 * Both leave as `failed-precondition` (the web reads it as "repeating the
 * same request cannot succeed", true for a device without a token).
 * `APP_CHECK_REQUIRED` is worded (`errors.APP_CHECK_REQUIRED`);
 * `APP_CHECK_REPLAYED` is not (OR-55: the build sends a fresh limited-use
 * token per call, so no web surface reaches it).
 */
export const AppCheckErrorCode = {
  /** ENFORCE: the request carried no verified App Check token. */
  Required: 'APP_CHECK_REQUIRED',
  /** ENFORCE: a limited-use callable received a token already consumed. */
  Replayed: 'APP_CHECK_REPLAYED',
} as const;
export type AppCheckErrorCode =
  (typeof AppCheckErrorCode)[keyof typeof AppCheckErrorCode];

export type AppCheckError = AppCheckError.Required | AppCheckError.Replayed;

export const AppCheckError = {
  /** No verified token: none arrived (`MISSING`) or the platform could not verify it (`INVALID`). */
  required(
    appCheckOutcome:
      typeof AppCheckOutcome.Missing | typeof AppCheckOutcome.Invalid,
  ): AppCheckError.Required {
    return { errorCode: AppCheckErrorCode.Required, appCheckOutcome };
  },
  /** A limited-use token the platform had consumed before. */
  replayed(): AppCheckError.Replayed {
    return {
      errorCode: AppCheckErrorCode.Replayed,
      appCheckOutcome: AppCheckOutcome.Replayed,
    };
  },
} as const;

export namespace AppCheckError {
  export type Required = {
    readonly errorCode: typeof AppCheckErrorCode.Required;
    /** Why no verified token: `MISSING` (no header) or `INVALID` (unverifiable). */
    readonly appCheckOutcome:
      typeof AppCheckOutcome.Missing | typeof AppCheckOutcome.Invalid;
  };
  export type Replayed = {
    readonly errorCode: typeof AppCheckErrorCode.Replayed;
    readonly appCheckOutcome: typeof AppCheckOutcome.Replayed;
  };
}
