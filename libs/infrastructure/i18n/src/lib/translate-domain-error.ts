import { TranslocoService } from '@jsverse/transloco';
import { FunctionsError } from 'firebase/functions';

const UNKNOWN_ERROR_KEY = 'errors.unknown';

interface CodedError {
  readonly code: string;
  readonly params?: Record<string, unknown>;
}

interface FunctionsErrorDetails {
  readonly code?: string;
  readonly params?: Record<string, unknown>;
  readonly errors?: readonly {
    readonly code: string;
    readonly params?: Record<string, unknown>;
  }[];
}

/**
 * Looks up `errors.<code>` for the active locale, interpolating `params`.
 * Falls back to the raw `code` (never a raw, untranslated exception
 * message) if the catalog has no entry for it.
 */
export function translateDomainError(
  transloco: TranslocoService,
  error: CodedError,
): string {
  const key = `errors.${error.code}`;
  const translated = transloco.translate(key, error.params ?? {});
  return translated === key ? error.code : translated;
}

/**
 * Unwraps a Firebase Callable Function error (thrown by `httpsCallable()`)
 * and resolves it to a localized message using the `code`/`params` (or
 * aggregated `errors[]`) forwarded via `HttpsError`'s `details`.
 */
export function translateFunctionsError(
  error: unknown,
  transloco: TranslocoService,
): string {
  if (!(error instanceof FunctionsError)) {
    return transloco.translate(UNKNOWN_ERROR_KEY);
  }

  const details = error.details as FunctionsErrorDetails | undefined;

  if (details?.errors && details.errors.length > 0) {
    return details.errors
      .map((e) => translateDomainError(transloco, e))
      .join(' ');
  }

  if (details?.code) {
    return translateDomainError(transloco, {
      code: details.code,
      params: details.params,
    });
  }

  return transloco.translate(UNKNOWN_ERROR_KEY);
}
