import { TranslocoService } from '@jsverse/transloco';
import { FunctionsError } from 'firebase/functions';

const UNKNOWN_ERROR_KEY = 'errors.unknown';

/**
 * The two shapes a refusal reaches the UI in (flatten-spec §4.3, F-23):
 *
 * - `{ code, params }` — a legacy `DomainError` class or the wire's
 *   `details` (the dotted code; looked up as `errors.<code>`);
 * - `{ errorCode, …fields }` — an ecs-core error struct (Law 7.5): the
 *   SCREAMING `errorCode` is looked up as `errors.<errorCode>` and the
 *   struct IS its params — every other field interpolates.
 */
type CodedError =
  | { readonly code: string; readonly params?: Record<string, unknown> }
  | ({ readonly errorCode: string } & Record<string, unknown>);

interface FunctionsErrorDetails {
  readonly code?: string;
  readonly params?: Record<string, unknown>;
  readonly errors?: readonly {
    readonly code: string;
    readonly params?: Record<string, unknown>;
  }[];
}

/** The owner-locked DST code (`TimeErrorCode.DstGap`, Law 7.3). */
const DST_GAP_INVALID_TIME = 'DST_GAP_INVALID_TIME';

const pad2 = (value: number): string => String(value).padStart(2, '0');

/**
 * The display params a struct's own fields imply. A DST-gap refusal names
 * the refused time of day, not a whole date: `wallClock` is its `localDate`
 * and `minute` as the wall clock the user typed (`2026-03-29T03:30`, the
 * legacy `rawValue` form). The struct's own fields stay as they are.
 */
function displayParamsOf(
  code: string,
  params: Record<string, unknown>,
): Record<string, unknown> {
  if (code !== DST_GAP_INVALID_TIME) return params;
  const localDate = params['localDate'];
  const minute = params['minute'];
  if (typeof localDate !== 'string' || typeof minute !== 'number') {
    return params;
  }
  return {
    ...params,
    wallClock: `${localDate}T${pad2(Math.floor(minute / 60))}:${pad2(minute % 60)}`,
  };
}

/**
 * Looks up `errors.<code>` (or `errors.<errorCode>` for an ecs-core struct)
 * for the active locale, interpolating `params` (or the struct's own
 * fields). Falls back to the raw code (never a raw, untranslated exception
 * message) if the catalog has no entry for it.
 */
export function translateDomainError(
  transloco: TranslocoService,
  error: CodedError,
): string {
  const [code, params] =
    'errorCode' in error && typeof error.errorCode === 'string'
      ? [error.errorCode, error]
      : [String(error.code), (error.params ?? {}) as Record<string, unknown>];
  const key = `errors.${code}`;
  const translated = transloco.translate(key, displayParamsOf(code, params));
  return translated === key ? code : translated;
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
