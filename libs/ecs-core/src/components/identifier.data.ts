import { Email } from './email.data';
import { IdentityError } from './identity-errors.data';
import { OtpDestinationType } from './otp-destination-type.data';
import type { E164 } from './phone-number.data';
import { Result } from './result.data';

/** The two channels a person can be reached at — the parse result's tag. */
export const IdentifierKind = {
  Phone: 'phone',
  Email: 'email',
} as const;
export type IdentifierKind =
  (typeof IdentifierKind)[keyof typeof IdentifierKind];

/**
 * The raw value of a reachable channel — a canonical E.164 number or a
 * canonical e-mail address — as a brand over the plain string. This is what
 * is **stored** (`otps.destination`, a scalar, so index #10 and the open
 * window probe keep working; blueprint §2.6). The `{ kind, value }`
 * {@link ParsedIdentifier} is the in-memory result of the edge parse and is
 * never stored: the adapter writes `destinationType` from its `kind`.
 */
export type Identifier = string & { readonly __brand: unique symbol };

export const Identifier = {
  /** The only cast site — for a value already canonical (read back from a document). */
  of: (raw: string): Identifier => raw as Identifier,
} as const;

/**
 * Turns a typed phone number into its canonical E.164, or `null` — the
 * caller passes `PhoneSystem.parse` bound to the deployment's default
 * country, so this component never imports a system (a `*.data.ts` never
 * may; the `VenuePhone` precedent, blueprint §2.5).
 */
export type ReadPhone = (raw: string) => E164 | null;

/**
 * A channel the auth flow challenges — a plain union over the two kinds,
 * each carrying the canonical value. Its companion holds every factory and
 * guard, so each variant's tag is read from {@link IdentifierKind} in one
 * place.
 */
export type ParsedIdentifier = ParsedIdentifier.Phone | ParsedIdentifier.Email;

export const ParsedIdentifier = {
  phone(e164: E164): ParsedIdentifier.Phone {
    return { kind: IdentifierKind.Phone, value: Identifier.of(e164) };
  },

  email(email: Email): ParsedIdentifier.Email {
    return { kind: IdentifierKind.Email, value: Identifier.of(email) };
  },

  /**
   * The edge guard — the ONLY way untrusted input becomes an identifier:
   * an e-mail through `Email.parse`, a phone through `readPhone`, either
   * refused as `identity.identifier.invalid` with the kind and raw text.
   */
  parse(
    kind: IdentifierKind,
    raw: string,
    readPhone: ReadPhone,
  ): Result<ParsedIdentifier, IdentityError> {
    if (kind === IdentifierKind.Phone) {
      const e164 = readPhone(raw);
      return e164 === null
        ? Result.err(IdentityError.identifierInvalid(kind, raw))
        : Result.ok(ParsedIdentifier.phone(e164));
    }
    const email = Email.parse(raw);
    return email === null
      ? Result.err(IdentityError.identifierInvalid(kind, raw))
      : Result.ok(ParsedIdentifier.email(email));
  },

  /**
   * The channel an OTP's destination names — its value and the stored
   * `destinationType` it is delivered over (the values were validated on
   * the way in).
   */
  ofDestination(
    destination: Identifier,
    destinationType: OtpDestinationType,
  ): ParsedIdentifier {
    return destinationType === OtpDestinationType.Sms
      ? { kind: IdentifierKind.Phone, value: destination }
      : { kind: IdentifierKind.Email, value: destination };
  },

  /** The stored channel tag a parsed identifier is delivered over. */
  destinationTypeOf(identifier: ParsedIdentifier): OtpDestinationType {
    return identifier.kind === IdentifierKind.Phone
      ? OtpDestinationType.Sms
      : OtpDestinationType.Email;
  },

  /**
   * A stable indexing key, `kind:value` — a rate-limit or blocklist index
   * keyed by channel (`identifierChannelKey`).
   */
  channelKey(identifier: ParsedIdentifier): string {
    return `${identifier.kind}:${identifier.value}`;
  },

  /** The same channel: same kind, same canonical value. */
  equals(a: ParsedIdentifier, b: ParsedIdentifier): boolean {
    return a.kind === b.kind && a.value === b.value;
  },
} as const;

export namespace ParsedIdentifier {
  export type Phone = {
    readonly kind: typeof IdentifierKind.Phone;
    readonly value: Identifier;
  };
  export type Email = {
    readonly kind: typeof IdentifierKind.Email;
    readonly value: Identifier;
  };
}
