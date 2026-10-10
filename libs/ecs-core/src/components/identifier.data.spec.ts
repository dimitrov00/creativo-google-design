import { describe, expect, it } from 'vitest';
import { PhoneSystem } from '../systems/phone.system';
import { CountryIso2 } from './country-iso2.data';
import { Email } from './email.data';
import {
  Identifier,
  IdentifierKind,
  ParsedIdentifier,
  type ReadPhone,
} from './identifier.data';
import { IdentityErrorCode } from './identity-errors.data';
import { OtpDestinationType } from './otp-destination-type.data';
import { E164 } from './phone-number.data';

/*
 * The cases of libs/domain/identity/src/lib/identifier.spec.ts, copied over
 * the brand: the phone reader is the real PhoneSystem bound to Bulgaria, as
 * an edge would wire it.
 */
const readPhone: ReadPhone = (raw) => {
  const result = PhoneSystem.parse(raw, CountryIso2.of('BG'));
  return result.ok ? result.value.e164 : null;
};

function parsed(kind: IdentifierKind, raw: string): ParsedIdentifier {
  const result = ParsedIdentifier.parse(kind, raw, readPhone);
  if (!result.ok) throw new Error('unexpected failure in test fixture');
  return result.value;
}

describe('ParsedIdentifier.parse', () => {
  it('validates a phone identifier to its canonical E.164', () => {
    expect(parsed(IdentifierKind.Phone, '+359885550100')).toEqual({
      kind: 'phone',
      value: '+359885550100',
    });
    // National format under the default country is the same channel.
    expect(parsed(IdentifierKind.Phone, '0885 550 100').value).toBe(
      '+359885550100',
    );
  });

  it('validates an email identifier to its canonical form', () => {
    expect(parsed(IdentifierKind.Email, ' Client@Example.com ')).toEqual({
      kind: 'email',
      value: 'client@example.com',
    });
  });

  it('rejects an invalid phone number with its kind and raw text', () => {
    const result = ParsedIdentifier.parse(
      IdentifierKind.Phone,
      'not-a-phone',
      readPhone,
    );
    expect(result).toEqual({
      ok: false,
      error: {
        code: IdentityErrorCode.IdentifierInvalid,
        identifierKind: 'phone',
        attempted: 'not-a-phone',
      },
    });
  });

  it('rejects an invalid email with its kind', () => {
    const result = ParsedIdentifier.parse(
      IdentifierKind.Email,
      'not-an-email',
      readPhone,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatchObject({ identifierKind: 'email' });
    }
  });
});

describe('Identifier factories and the stored pair', () => {
  it('phone() / email() wrap already-canonical values', () => {
    expect(ParsedIdentifier.phone(E164.of('+359885550100'))).toEqual({
      kind: 'phone',
      value: '+359885550100',
    });
    expect(ParsedIdentifier.email(Email.of('client@example.com'))).toEqual({
      kind: 'email',
      value: 'client@example.com',
    });
  });

  it('destinationTypeOf maps phone → sms and email → email', () => {
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

  it('ofDestination rebuilds the parse result from destination + destinationType', () => {
    expect(
      ParsedIdentifier.ofDestination(
        Identifier.of('+359885550100'),
        OtpDestinationType.Sms,
      ),
    ).toEqual({ kind: 'phone', value: '+359885550100' });
    expect(
      ParsedIdentifier.ofDestination(
        Identifier.of('a@b.co'),
        OtpDestinationType.Email,
      ),
    ).toEqual({ kind: 'email', value: 'a@b.co' });
  });
});

describe('ParsedIdentifier.channelKey', () => {
  it('formats kind:value', () => {
    expect(
      ParsedIdentifier.channelKey(
        ParsedIdentifier.email(Email.of('client@example.com')),
      ),
    ).toBe('email:client@example.com');
  });
});

describe('ParsedIdentifier.equals', () => {
  it('is true for the same kind and value', () => {
    const a = ParsedIdentifier.email(Email.of('client@example.com'));
    const b = ParsedIdentifier.email(Email.of('client@example.com'));
    expect(ParsedIdentifier.equals(a, b)).toBe(true);
  });

  it('is false across different kinds', () => {
    const a = ParsedIdentifier.email(Email.of('client@example.com'));
    expect(
      ParsedIdentifier.equals(a, parsed(IdentifierKind.Phone, '+359885550100')),
    ).toBe(false);
  });

  it('is false for different values of the same kind', () => {
    const a = ParsedIdentifier.phone(E164.of('+359885550100'));
    const b = ParsedIdentifier.phone(E164.of('+359888123456'));
    expect(ParsedIdentifier.equals(a, b)).toBe(false);
  });
});
