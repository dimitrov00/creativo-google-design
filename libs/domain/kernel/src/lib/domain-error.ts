/**
 * Base for every domain/use-case error in this repo. `message` stays an
 * English, developer-facing description (logs/debugging — never shown to
 * an end user, so it doesn't need to be localized). `code` is the stable,
 * language-neutral key the frontend resolves to a real, localized message
 * at display time (see `libs/adapters/i18n`'s `translateDomainError`).
 * `params` carries interpolation data for that lookup (e.g. `{ rawValue }`
 * for "Invalid email: {rawValue}").
 *
 * Every subclass overrides `code` with a `snake_case` literal. Codes are
 * globally namespaced strings, not per-file enums — no need to avoid
 * collisions across files as long as each one is unique and descriptive.
 */
export abstract class DomainError extends Error {
  abstract readonly code: string;
  readonly params: Readonly<Record<string, unknown>>;

  constructor(message: string, params: Record<string, unknown> = {}) {
    super(message);
    this.params = params;
  }
}
