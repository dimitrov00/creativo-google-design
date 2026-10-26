import { TranslocoService } from '@jsverse/transloco';
import { WallTime } from '@core/components';
import { IdentityErrorCode, TimeErrorCode } from '@core/errors';
import { LocalDate, MinuteOfDay } from '@core/primitives';

/**
 * The one shape a refusal reaches the UI in (Law 7.5): an ecs-core error
 * struct, `{ errorCode, …fields }`. The SCREAMING `errorCode` is looked up
 * as `errors.<errorCode>` and the struct IS its params — every other field
 * interpolates.
 */
type CodedError = { readonly errorCode: string } & Record<string, unknown>;

/**
 * The display params a struct's own fields imply. A throttled code request
 * (`IdentityErrorCode.OtpRateLimited`, OR-9) prints its `retryAfterSeconds`
 * as `seconds`. A DST-gap refusal
 * (`TimeErrorCode.DstGap`, Law 7.3) names the refused time of day, not a
 * whole date: `wallClock` is its `localDate` and `minute` as the wall clock
 * the user typed (`2026-03-29T03:30`, the legacy `rawValue` form —
 * {@link WallTime.toLocalIso}). The struct's own fields stay as they are.
 *
 * The struct reaches this lookup untyped (`Record<string, unknown>`, maybe
 * decoded off the wire), so its two fields become brands here, once, through
 * the smart constructors. Every DST-gap struct is minted by
 * `TimeError.dstGap(localDate: LocalDate, minute: MinuteOfDay, …)` — a real
 * shop day and a minute in `[0, 1440)` — so neither constructor refuses a
 * struct the app raises; a field that is not one keeps the params as they
 * are, as a non-string day or a non-number minute does.
 */
function displayParamsOf(
  code: string,
  params: Record<string, unknown>,
): Record<string, unknown> {
  // A throttled code request names the seconds left (OR-9): the copy's
  // `{{seconds}}` is the struct's `retryAfterSeconds`.
  if (code === IdentityErrorCode.OtpRateLimited) {
    const seconds = params['retryAfterSeconds'];
    return typeof seconds === 'number' ? { ...params, seconds } : params;
  }
  if (code !== TimeErrorCode.DstGap) return params;
  const rawDate = params['localDate'];
  const rawMinute = params['minute'];
  if (typeof rawDate !== 'string' || typeof rawMinute !== 'number') {
    return params;
  }
  const localDate = LocalDate.parse(rawDate);
  const minute = MinuteOfDay.of(rawMinute);
  if (!localDate.ok || !minute.ok) return params;
  return {
    ...params,
    wallClock: WallTime.toLocalIso(WallTime.of(localDate.value, minute.value)),
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
export function translateCodedError(
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
