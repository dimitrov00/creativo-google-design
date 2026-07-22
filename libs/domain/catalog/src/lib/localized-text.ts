import { Result, combineAll, fail, ok } from '@creativo/domain/kernel';
import { LocalizedTextFieldEmptyError } from './localized-text.errors';

export interface LocalizedTextProps {
  en: string;
  bg: string;
}

/**
 * Minimal bg/en display-text pair — "two required, non-empty locale
 * strings". A deliberately small stand-in for v2's full `LocalizedText`
 * i18n record type (which rides on a Transloco-adjacent i18n system with
 * arbitrary-locale support and fallback resolution). This pure-domain pass
 * has exactly two locales and no i18n-library dependency, so it isn't
 * ported — see the deviation log. Used for `Barber.name/title/bio`,
 * `Location.name/address`, `ServiceCategory.name`, `Service.name/description`.
 */
export class LocalizedText {
  private constructor(
    private readonly _en: string,
    private readonly _bg: string,
  ) {}

  /** Validating factory — the ONLY way untrusted input becomes a LocalizedText. */
  static create(
    props: LocalizedTextProps,
  ): Result<LocalizedText, LocalizedTextFieldEmptyError[]> {
    const enResult = LocalizedText.validateField('en', props.en);
    const bgResult = LocalizedText.validateField('bg', props.bg);
    const combined = combineAll([enResult, bgResult] as const);
    if (combined.isFailure()) {
      return fail(combined.error);
    }
    const [en, bg] = combined.value;
    return ok(new LocalizedText(en, bg));
  }

  /** Rebuild from persistence that was validated on the way in. Never call with unvalidated input. */
  static fromPrimitive(trusted: LocalizedTextProps): LocalizedText {
    return new LocalizedText(trusted.en, trusted.bg);
  }

  get en(): string {
    return this._en;
  }

  get bg(): string {
    return this._bg;
  }

  get(locale: 'en' | 'bg'): string {
    return locale === 'en' ? this._en : this._bg;
  }

  equals(other: LocalizedText): boolean {
    return this._en === other._en && this._bg === other._bg;
  }

  /** English string, for developer-facing contexts (logs, non-localized fallback). */
  toString(): string {
    return this._en;
  }

  private static validateField(
    locale: 'en' | 'bg',
    raw: string,
  ): Result<string, LocalizedTextFieldEmptyError> {
    const trimmed = raw.trim();
    return trimmed.length > 0
      ? ok(trimmed)
      : fail(new LocalizedTextFieldEmptyError(locale));
  }
}
