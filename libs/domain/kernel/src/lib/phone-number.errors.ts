import { DomainError } from './domain-error';

/**
 * Why a raw string failed to become a `PhoneNumber` — maps 1:1 to distinct
 * localized error copy (Transloco keys) so the UI can say "too short, for
 * example 088 123 4567" instead of one generic "invalid". `'invalid'` is
 * the fallback for numbers that parse but fail validation without a more
 * specific diagnosis.
 */
export type PhoneNumberInvalidReason =
  'not-a-number' | 'too-short' | 'too-long' | 'invalid-country' | 'invalid';

export class PhoneNumberInvalidError extends DomainError {
  readonly code = 'phone_number_invalid' as const;
  constructor(
    public readonly attempted: string,
    public readonly reason: PhoneNumberInvalidReason,
  ) {
    super(`"${attempted}" is not a valid phone number (${reason})`, {
      attempted,
      reason,
    });
  }
}
