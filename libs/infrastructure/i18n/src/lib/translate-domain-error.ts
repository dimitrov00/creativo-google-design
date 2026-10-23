import { TranslocoService } from '@jsverse/transloco';

/**
 * The one shape a refusal reaches the UI in (Law 7.5): an ecs-core error
 * struct, `{ errorCode, …fields }`. The SCREAMING `errorCode` is looked up
 * as `errors.<errorCode>` and the struct IS its params — every other field
 * interpolates.
 */
type CodedError = { readonly errorCode: string } & Record<string, unknown>;

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
 * Looks up `errors.<errorCode>` for the active locale, interpolating the
 * struct's own fields. Falls back to the raw `errorCode` (never a raw,
 * untranslated exception message) if the catalog has no entry for it.
 *
 * With a `reason`, the lookup goes one level down — `errors.<errorCode>.<reason>`,
 * falling back to the raw `<errorCode>.<reason>` — so a struct keeps its own
 * dictionary `errorCode` (Law 7.5) while its reason picks the words
 * (`PHONE_INVALID.too-short`, the `PhoneInvalidReason` value itself: nothing
 * is mapped). The ONE place a reason-level key is built for a struct.
 */
export function translateDomainError(
  transloco: TranslocoService,
  error: CodedError,
  reason?: string,
): string {
  const base = error.errorCode;
  const code = reason === undefined ? base : `${base}.${reason}`;
  const key = `errors.${code}`;
  const translated = transloco.translate(key, displayParamsOf(base, error));
  return translated === key ? code : translated;
}
