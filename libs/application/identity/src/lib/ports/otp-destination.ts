import {
  Email,
  InvalidEmailError,
  OtpDestinationType,
} from '@creativo/domain/models';
import {
  PhoneNumber,
  PhoneNumberInvalidError,
  Result,
  fail,
  ok,
} from '@creativo/domain/kernel';

/**
 * An OTP send/lookup target — replaces passing a bare `destination: string`
 * + `destinationType: 'email' | 'sms'` pair across a port boundary. The
 * discriminant IS the destination type, so no separate field is needed.
 */
export type OtpDestination =
  | { readonly kind: 'email'; readonly email: Email }
  | { readonly kind: 'sms'; readonly phone: PhoneNumber };

export function otpDestinationValue(destination: OtpDestination): string {
  return destination.kind === 'email'
    ? destination.email.value
    : destination.phone.value;
}

/** Reconstructs an `OtpDestination` from an already-persisted (raw) pair — e.g. off an `Otp` entity read back from storage. */
export function otpDestinationFromRaw(
  raw: string,
  kind: OtpDestinationType,
): Result<OtpDestination, InvalidEmailError | PhoneNumberInvalidError> {
  if (kind === 'email') {
    const emailResult = Email.create(raw);
    if (emailResult.isFailure()) {
      return fail(emailResult.error);
    }
    return ok({ kind: 'email', email: emailResult.value });
  }
  const phoneResult = PhoneNumber.create(raw);
  if (phoneResult.isFailure()) {
    return fail(phoneResult.error);
  }
  return ok({ kind: 'sms', phone: phoneResult.value });
}
