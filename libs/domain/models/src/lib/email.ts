import { Result, fail, ok } from '@creativo/domain/kernel';
import { InvalidEmailError } from './email.errors';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export class Email {
  private constructor(public readonly value: string) {}

  static create(emailAddress: string): Result<Email, InvalidEmailError> {
    const cleanEmail = emailAddress.trim().toLowerCase();

    if (!EMAIL_REGEX.test(cleanEmail)) {
      return fail(new InvalidEmailError(emailAddress));
    }

    return ok(new Email(cleanEmail));
  }

  equals(other: Email): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}
