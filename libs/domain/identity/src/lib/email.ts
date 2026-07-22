import { Result, fail, ok } from '@creativo/domain/kernel';
import { EmailInvalidError } from './email.errors';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * A verified-channel-capable email address — the email variant of
 * `Identifier`. Kept local to `domain/identity` (rather than importing
 * accounts' own `Email`) so this bounded context doesn't structurally
 * depend on another one for a value object it needs at its own boundary;
 * see the final report for the cross-context duplication this implies.
 */
export class Email {
  private constructor(private readonly _value: string) {}

  /** Validating factory — the ONLY way user input becomes an Email. */
  static create(raw: string): Result<Email, EmailInvalidError> {
    const cleaned = raw.trim().toLowerCase();
    if (!EMAIL_PATTERN.test(cleaned)) {
      return fail(new EmailInvalidError(raw));
    }
    return ok(new Email(cleaned));
  }

  /** Rebuild from persistence that was validated on the way in. Never call with user input. */
  static fromPrimitive(trusted: string): Email {
    return new Email(trusted);
  }

  get value(): string {
    return this._value;
  }

  equals(other: Email): boolean {
    return this._value === other._value;
  }

  toString(): string {
    return this._value;
  }
}
