import {
  PhoneNumber,
  Result,
  combineAll,
  fail,
  ok,
} from '@creativo/domain/kernel';
import {
  BlankVenuePhoneDisplayError,
  VenuePhoneValidationError,
} from './venue-phone.errors';

export interface VenuePhoneProps {
  e164: string;
  display: string;
}

/**
 * A venue's contact phone as TENANT CONTENT: canonical E.164 (the `tel:`
 * href) plus the admin-authored display string the UI renders verbatim.
 * Denormalized rather than formatted at render time — ports v2's
 * `VenuePhone` rationale (a venue phone renders on the public marketing
 * landing; pre-formatting it once at authoring time keeps every render
 * path free of `PhoneNumber`'s libphonenumber-js closure). Composes the
 * kernel's `PhoneNumber` for E.164 validation rather than reimplementing
 * E.164 parsing.
 */
export class VenuePhone {
  private constructor(
    private readonly phoneNumber: PhoneNumber,
    readonly display: string,
  ) {}

  static create(
    props: VenuePhoneProps,
  ): Result<VenuePhone, VenuePhoneValidationError[]> {
    return VenuePhone.build(props);
  }

  static reconstitute(
    props: VenuePhoneProps,
  ): Result<VenuePhone, VenuePhoneValidationError[]> {
    return VenuePhone.build(props);
  }

  private static build(
    props: VenuePhoneProps,
  ): Result<VenuePhone, VenuePhoneValidationError[]> {
    const phoneResult = PhoneNumber.create(props.e164);
    const displayResult = VenuePhone.validateDisplay(props.display);

    const combined = combineAll([phoneResult, displayResult] as const);
    if (combined.isFailure()) {
      return fail(combined.error);
    }
    const [phoneNumber, display] = combined.value;
    return ok(new VenuePhone(phoneNumber, display));
  }

  private static validateDisplay(
    raw: string,
  ): Result<string, BlankVenuePhoneDisplayError> {
    const trimmed = raw.trim();
    return trimmed.length > 0
      ? ok(trimmed)
      : fail(new BlankVenuePhoneDisplayError());
  }

  /** Canonical E.164 form, e.g. `'+359881234567'` — drives `tel:` links. */
  get e164(): string {
    return this.phoneNumber.value;
  }

  equals(other: VenuePhone): boolean {
    return (
      this.phoneNumber.equals(other.phoneNumber) &&
      this.display === other.display
    );
  }
}
