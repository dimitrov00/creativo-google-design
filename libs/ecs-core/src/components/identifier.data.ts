import {
  type Brand,
  IdentityError,
  Result,
  IdentifierChannel,
} from '@core/primitives';
import { Email } from './email.data';
import { OtpDestinationType } from './otp-destination-type.data';
import type { E164 } from './phone-number.data';

/**
 * The text a channel is spelled with inside {@link ParsedIdentifier.channelKey}
 * — today's `phone:` / `email:` key prefixes, unchanged (flatten-spec §3.7),
 * so a stored rate-limit or blocklist key never moves.
 */
const CHANNEL_KEY_PREFIX = {
  [IdentifierChannel.Phone]: 'phone',
  [IdentifierChannel.Email]: 'email',
} as const;

/**
 * The raw value of a reachable channel — a canonical E.164 number or a
 * canonical e-mail address — as a brand over the plain string. This is what
 * is **stored** (`otps.destination`, a scalar, so index #10 and the open
 * window probe keep working; blueprint §2.6). The
 * `{ identifierChannel, identifier }` {@link ParsedIdentifier} is the
 * in-memory result of the edge parse and is never stored: the OTP keeps
 * its `otpDestinationType` beside the raw `destination`.
 */
export type Identifier = Brand<string, 'Identifier'>;

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
 * A channel the auth flow challenges — a union of two flat variants, each
 * carrying the canonical value as `identifier`. Its companion holds every
 * factory and guard, so each variant's tag is read from
 * {@link IdentifierChannel} in one place.
 */
export type ParsedIdentifier = ParsedIdentifier.Phone | ParsedIdentifier.Email;

export const ParsedIdentifier = {
  phone(e164: E164): ParsedIdentifier.Phone {
    return {
      identifierChannel: IdentifierChannel.Phone,
      identifier: Identifier.of(e164),
    };
  },

  email(email: Email): ParsedIdentifier.Email {
    return {
      identifierChannel: IdentifierChannel.Email,
      identifier: Identifier.of(email),
    };
  },

  /**
   * The edge guard — the ONLY way untrusted input becomes an identifier:
   * an e-mail through `Email.parse`, a phone through `readPhone`, either
   * refused as `IDENTITY_IDENTIFIER_INVALID` with the channel and raw text.
   */
  parse(
    identifierChannel: IdentifierChannel,
    raw: string,
    readPhone: ReadPhone,
  ): Result<ParsedIdentifier, IdentityError> {
    if (identifierChannel === IdentifierChannel.Phone) {
      const e164 = readPhone(raw);
      return e164 === null
        ? Result.err(IdentityError.identifierInvalid(identifierChannel, raw))
        : Result.ok(ParsedIdentifier.phone(e164));
    }
    const email = Email.parse(raw);
    return email === null
      ? Result.err(IdentityError.identifierInvalid(identifierChannel, raw))
      : Result.ok(ParsedIdentifier.email(email));
  },

  /**
   * The channel an OTP's destination names — its value and the stored
   * `otpDestinationType` it is delivered over (the values were validated on
   * the way in).
   */
  ofDestination(
    destination: Identifier,
    otpDestinationType: OtpDestinationType,
  ): ParsedIdentifier {
    return otpDestinationType === OtpDestinationType.Sms
      ? { identifierChannel: IdentifierChannel.Phone, identifier: destination }
      : { identifierChannel: IdentifierChannel.Email, identifier: destination };
  },

  /** The stored channel tag a parsed identifier is delivered over. */
  destinationTypeOf(parsed: ParsedIdentifier): OtpDestinationType {
    return parsed.identifierChannel === IdentifierChannel.Phone
      ? OtpDestinationType.Sms
      : OtpDestinationType.Email;
  },

  /**
   * A stable indexing key, `phone:<value>` / `email:<value>` — a rate-limit
   * or blocklist index keyed by channel (`identifierChannelKey`); the text
   * is today's, unchanged.
   */
  channelKey(parsed: ParsedIdentifier): string {
    return `${CHANNEL_KEY_PREFIX[parsed.identifierChannel]}:${parsed.identifier}`;
  },

  /** The same channel: same channel tag, same canonical value. */
  equals(a: ParsedIdentifier, b: ParsedIdentifier): boolean {
    return (
      a.identifierChannel === b.identifierChannel &&
      a.identifier === b.identifier
    );
  },
} as const;

export namespace ParsedIdentifier {
  export type Phone = {
    readonly identifierChannel: typeof IdentifierChannel.Phone;
    readonly identifier: Identifier;
  };
  export type Email = {
    readonly identifierChannel: typeof IdentifierChannel.Email;
    readonly identifier: Identifier;
  };
}
