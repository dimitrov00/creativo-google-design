import type { PipelineError } from '@core/errors';

/**
 * Looks one i18n code up with its parameters — answering the code ITSELF
 * when the catalogue has no copy for it (`translateCodedError`'s contract).
 */
export type TranslateCode = (
  code: string,
  params: Readonly<Record<string, unknown>>,
) => string;

/** The server's codes to try, most specific first. */
function serverCopyCodes(error: PipelineError): readonly string[] {
  const code = error.serverErrorCode;
  if (code === null || code.length === 0) return [];
  // WHY, one level down: a carried seat's refusal, the field an invalid
  // request names, or the capability a staff-access refusal names
  // (`ACCESS_DENIED.HOURS` — staff permissions P6). Never two — they ride
  // on different codes.
  const capability = error.serverParams['staffCapability'];
  const reason =
    error.refusal !== null && error.refusal.length > 0
      ? error.refusal
      : error.field !== null && error.field.length > 0
        ? error.field
        : typeof capability === 'string' && capability.length > 0
          ? capability
          : null;
  return reason === null ? [code] : [`${code}.${reason}`, code];
}

/**
 * A failed call in the most specific words the catalogue has (Phase 4a
 * 4A-5; successor of the legacy `wordError`) — the ONE rule every surface
 * that narrates a call's failure follows. The server's own code wins when
 * the catalogue has copy for it, read one level deeper first when it names
 * its reason (`<serverErrorCode>.<refusal|field|staffCapability>`, then
 * `<serverErrorCode>`);
 * otherwise the surface's own generic key (`fallbackCode`), so the generic
 * copy stays its own. Interpolates the wire's allowlisted `serverParams`
 * merged with the surface's `extraParams` (the words it derives — the
 * transition refusal's `from`/`to`, the booking reach's `reach`), the
 * surface's winning on a shared name.
 */
export function wordPipelineError(
  error: PipelineError,
  translate: TranslateCode,
  fallbackCode: string,
  extraParams: Readonly<Record<string, string>> = {},
): string {
  return (
    wordServerRefusal(error, translate, extraParams) ??
    translate(fallbackCode, { ...error.serverParams, ...extraParams })
  );
}

/**
 * The server's own refusal in the catalogue's words, or `null` when the
 * call named no server code or the catalogue has no copy for it — the
 * first half of {@link wordPipelineError}'s rule, for a surface whose
 * generic line is its own UI copy rather than an error code (the staff
 * block editor, the hours sheet).
 */
export function wordServerRefusal(
  error: PipelineError,
  translate: TranslateCode,
  extraParams: Readonly<Record<string, string>> = {},
): string | null {
  const params = { ...error.serverParams, ...extraParams };
  for (const code of serverCopyCodes(error)) {
    const worded = translate(code, params);
    if (worded !== code) return worded;
  }
  return null;
}
