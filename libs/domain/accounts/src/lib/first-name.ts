import { Result, fail, ok } from '@creativo/domain/kernel';
import { FirstNameTooShortError } from './first-name.errors';

/** Ports v2's `primitives/FirstName.ts` Opaque-type rule into a Result factory. */
export const FIRST_NAME_MIN_LENGTH = 2;

export class FirstName {
  private constructor(private readonly _value: string) {}

  /** Validating factory — the ONLY way user input becomes a FirstName. */
  static create(raw: string): Result<FirstName, FirstNameTooShortError> {
    const trimmed = raw.trim();
    if (trimmed.length < FIRST_NAME_MIN_LENGTH) {
      return fail(new FirstNameTooShortError(raw, FIRST_NAME_MIN_LENGTH));
    }
    return ok(new FirstName(trimmed));
  }

  /** Rebuild from persistence that was validated on the way in. Never call with user input. */
  static fromPrimitive(trusted: string): FirstName {
    return new FirstName(trusted);
  }

  get value(): string {
    return this._value;
  }

  equals(other: FirstName): boolean {
    return this._value === other._value;
  }

  toString(): string {
    return this._value;
  }
}
