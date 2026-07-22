import { Result, fail, ok } from '@creativo/domain/kernel';
import { LastNameTooShortError } from './last-name.errors';

/** Ports v2's `primitives/LastName.ts` Opaque-type rule into a Result factory. */
export const LAST_NAME_MIN_LENGTH = 2;

export class LastName {
  private constructor(private readonly _value: string) {}

  /** Validating factory — the ONLY way user input becomes a LastName. */
  static create(raw: string): Result<LastName, LastNameTooShortError> {
    const trimmed = raw.trim();
    if (trimmed.length < LAST_NAME_MIN_LENGTH) {
      return fail(new LastNameTooShortError(raw, LAST_NAME_MIN_LENGTH));
    }
    return ok(new LastName(trimmed));
  }

  /** Rebuild from persistence that was validated on the way in. Never call with user input. */
  static fromPrimitive(trusted: string): LastName {
    return new LastName(trusted);
  }

  get value(): string {
    return this._value;
  }

  equals(other: LastName): boolean {
    return this._value === other._value;
  }

  toString(): string {
    return this._value;
  }
}
