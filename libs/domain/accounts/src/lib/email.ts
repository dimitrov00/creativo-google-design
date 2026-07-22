import { Result, fail, ok } from '@creativo/domain/kernel';
import { EmailInvalidError } from './email.errors';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Ported from blueprint §2.3 — the reference VO shape for this context. */
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
