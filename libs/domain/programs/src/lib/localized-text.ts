import { Result, combineAll, fail, ok } from '@creativo/domain/kernel';
import { LocalizedTextFieldEmptyError } from './localized-text.errors';

export interface LocalizedTextProps {
  en: string;
  bg: string;
}

/** Minimal bg/en display-text pair — same shape as `catalog`'s `LocalizedText`, kept as its own copy in this context rather than an import across the bounded-context boundary. */
export class LocalizedText {
  private constructor(
    private readonly _en: string,
    private readonly _bg: string,
  ) {}

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
