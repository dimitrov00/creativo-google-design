import { PhoneNumber, Result, fail, ok } from '@creativo/domain/kernel';
import { Email } from './email';
import { IdentifierInvalidError } from './identifier.errors';

/**
 * Derives the `defaultCountry` parameter type straight off the kernel's own
 * `PhoneNumber.create` signature instead of importing `libphonenumber-js`'s
 * `CountryCode` directly — ESLint blocks that import outside
 * `domain/kernel`, and the kernel's public index doesn't re-export the type
 * on its own.
 */
export type IdentifierDefaultCountry = Parameters<typeof PhoneNumber.create>[1];

export interface PhoneIdentifier {
  readonly kind: 'phone';
  readonly value: PhoneNumber;
}

export interface EmailIdentifier {
  readonly kind: 'email';
  readonly value: Email;
}

/**
 * A verified channel a user can be reached at — either a phone number or
 * an email address. The auth flow's request/verify-challenge operations are
 * polymorphic over this; a plain discriminated union of already-validated
 * value objects (mirrors `AppointmentStatus`'s house style), not a class —
 * there's no independent identity or lifecycle here beyond the two VOs it
 * wraps.
 */
export type Identifier = PhoneIdentifier | EmailIdentifier;

export function phoneIdentifier(value: PhoneNumber): PhoneIdentifier {
  return { kind: 'phone', value };
}

export function emailIdentifier(value: Email): EmailIdentifier {
  return { kind: 'email', value };
}

export interface IdentifierInput {
  readonly kind: 'phone' | 'email';
  readonly value: string;
}

/** Validating factory — the ONLY way untrusted user input becomes an Identifier. */
export function createIdentifier(
  input: IdentifierInput,
  defaultCountry?: IdentifierDefaultCountry,
): Result<Identifier, IdentifierInvalidError> {
  if (input.kind === 'phone') {
    const result = PhoneNumber.create(input.value, defaultCountry);
    if (result.isFailure()) {
      return fail(new IdentifierInvalidError('phone', input.value));
    }
    return ok(phoneIdentifier(result.value));
  }
  const result = Email.create(input.value);
  if (result.isFailure()) {
    return fail(new IdentifierInvalidError('email', input.value));
  }
  return ok(emailIdentifier(result.value));
}

/** Rebuild from persistence that was validated on the way in. Never call with user input. */
export function reconstituteIdentifier(input: IdentifierInput): Identifier {
  return input.kind === 'phone'
    ? phoneIdentifier(PhoneNumber.fromPrimitive(input.value))
    : emailIdentifier(Email.fromPrimitive(input.value));
}

/**
 * Stable indexing key — e.g. for an `otps/{channelKey}` document path or a
 * rate-limit/blocklist index keyed by channel.
 */
export function identifierChannelKey(identifier: Identifier): string {
  return `${identifier.kind}:${identifier.value.toString()}`;
}

/** Whether two identifiers refer to the same channel. */
export function identifierEquals(a: Identifier, b: Identifier): boolean {
  if (a.kind === 'phone' && b.kind === 'phone') return a.value.equals(b.value);
  if (a.kind === 'email' && b.kind === 'email') return a.value.equals(b.value);
  return false;
}
