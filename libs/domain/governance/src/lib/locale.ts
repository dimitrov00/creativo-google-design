import { Result, fail, ok } from '@creativo/domain/kernel';
import { InvalidLocaleError } from './locale.errors';

/**
 * UI-chrome locale code — matches `libs/adapters/i18n`'s
 * `availableLangs: ['en', 'bg']` (day-0 i18n: English + Bulgarian). Closed
 * union, unlike a tenant's open CONTENT-locale set (v2's `LocaleCode`
 * distinction between chrome i18n and content i18n) — `TenantConfig`
 * here only needs the UI-chrome default, not a content-authoring locale
 * list, so the open/closed distinction v2 draws doesn't have a second
 * side to port yet.
 */
export type Locale = 'en' | 'bg';

export const LOCALES: readonly Locale[] = ['en', 'bg'];

export function isLocale(value: unknown): value is Locale {
  return (
    typeof value === 'string' && (LOCALES as readonly string[]).includes(value)
  );
}

/** Validating factory — the door a raw string (e.g. an admin config form) uses to become a Locale. */
export function parseLocale(raw: string): Result<Locale, InvalidLocaleError> {
  return isLocale(raw) ? ok(raw) : fail(new InvalidLocaleError(raw));
}
