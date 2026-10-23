import { describe, expect, it } from 'vitest';
import { PhoneSystem } from '@core/systems';
import { CountryIso2 } from './country-iso2.data';
import { Email } from './email.data';
import {
  Identifier,
  ParsedIdentifier,
  type ReadPhone,
} from './identifier.data';
import { IdentifierChannel } from '@core/primitives';
import { IdentityErrorCode } from '@core/errors';
import { OtpDestinationType } from './otp-destination-type.data';
import { E164 } from './phone-number.data';

/*
 * The cases of the legacy identity `identifier.spec.ts` (deleted in Phase 4b;
 * ledger `docs/architecture/flips/phase-4b-delete.md` §11.1), copied over the
 * brand: the phone reader is the real PhoneSystem bound to Bulgaria, as an edge
 * would wire it.
 */
const readPhone: ReadPhone = (raw) => {
  const result = PhoneSystem.parse(raw, CountryIso2.of('BG'));
  return result.ok ? result.value.e164 : null;
};

function parsed(
  identifierChannel: IdentifierChannel,
  raw: string,
): ParsedIdentifier {
  const result = ParsedIdentifier.parse(identifierChannel, raw, readPhone);
  if (!result.ok) throw new Error('unexpected failure in test fixture');
  return result.value;
}

describe('ParsedIdentifier.parse', () => {
  it('validates a phone identifier to its canonical E.164', () => {
    expect(parsed(IdentifierChannel.Phone, '+359885550100')).toEqual({
      identifierChannel: 'PHONE',
      identifier: '+359885550100',
    });
    // National format under the default country is the same channel.
    expect(parsed(IdentifierChannel.Phone, '0885 550 100').identifier).toBe(
      '+359885550100',
    );
  });

  it('validates an email identifier to its canonical form', () => {
    expect(parsed(IdentifierChannel.Email, ' Client@Example.com ')).toEqual({
      identifierChannel: 'EMAIL',
      identifier: 'client@example.com',
    });
  });

  it('rejects an invalid phone number with its channel and raw text', () => {
    const result = ParsedIdentifier.parse(
      IdentifierChannel.Phone,
      'not-a-phone',
      readPhone,
    );
    expect(result).toEqual({
      ok: false,
      error: {
        errorCode: IdentityErrorCode.IdentifierInvalid,
        identifierKind: 'PHONE',
        attempted: 'not-a-phone',
      },
    });
  });

  it('rejects an invalid email with its channel', () => {
    const result = ParsedIdentifier.parse(
      IdentifierChannel.Email,
      'not-an-email',
      readPhone,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatchObject({ identifierKind: 'EMAIL' });
    }
  });
});

describe('Identifier factories and the stored pair', () => {
  it('phone() / email() wrap already-canonical values', () => {
    expect(ParsedIdentifier.phone(E164.of('+359885550100'))).toEqual({
      identifierChannel: 'PHONE',
      identifier: '+359885550100',
    });
    expect(ParsedIdentifier.email(Email.of('client@example.com'))).toEqual({
      identifierChannel: 'EMAIL',
      identifier: 'client@example.com',
    });
  });

  it('destinationTypeOf maps PHONE → SMS and EMAIL → EMAIL', () => {
    expect(
      ParsedIdentifier.destinationTypeOf(
        ParsedIdentifier.phone(E164.of('+359885550100')),
      ),
    ).toBe(OtpDestinationType.Sms);
    expect(
      ParsedIdentifier.destinationTypeOf(
        ParsedIdentifier.email(Email.of('a@b.co')),
      ),
    ).toBe(OtpDestinationType.Email);
  });

  it('ofDestination rebuilds the parse result from destination + otpDestinationType', () => {
    expect(
      ParsedIdentifier.ofDestination(
        Identifier.of('+359885550100'),
        OtpDestinationType.Sms,
      ),
    ).toEqual({
      identifierChannel: 'PHONE',
      identifier: '+359885550100',
    });
    expect(
      ParsedIdentifier.ofDestination(
        Identifier.of('a@b.co'),
        OtpDestinationType.Email,
      ),
    ).toEqual({
      identifierChannel: 'EMAIL',
      identifier: 'a@b.co',
    });
  });
});

describe('ParsedIdentifier.channelKey', () => {
  it('formats channel:value with today’s lowercase channel text, unchanged', () => {
    expect(
      ParsedIdentifier.channelKey(
        ParsedIdentifier.email(Email.of('client@example.com')),
      ),
    ).toBe('email:client@example.com');
    expect(
      ParsedIdentifier.channelKey(
        ParsedIdentifier.phone(E164.of('+359885550100')),
      ),
    ).toBe('phone:+359885550100');
  });
});

describe('ParsedIdentifier.equals', () => {
  it('is true for the same channel and value', () => {
    const a = ParsedIdentifier.email(Email.of('client@example.com'));
    const b = ParsedIdentifier.email(Email.of('client@example.com'));
    expect(ParsedIdentifier.equals(a, b)).toBe(true);
  });

  it('is false across different channels', () => {
    const a = ParsedIdentifier.email(Email.of('client@example.com'));
    expect(
      ParsedIdentifier.equals(
        a,
        parsed(IdentifierChannel.Phone, '+359885550100'),
      ),
    ).toBe(false);
  });

  it('is false for different values of the same channel', () => {
    const a = ParsedIdentifier.phone(E164.of('+359885550100'));
    const b = ParsedIdentifier.phone(E164.of('+359888123456'));
    expect(ParsedIdentifier.equals(a, b)).toBe(false);
  });
});
