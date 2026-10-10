import { describe, expect, it } from 'vitest';
import { CountryIso2 } from '../components/country-iso2.data';
import {
  PhoneErrorCode,
  PhoneInvalidReason,
} from '../components/phone-errors.data';
import { E164 } from '../components/phone-number.data';
import type { Result } from '../components/result.data';
import { PhoneSystem, type CountryNaming } from './phone.system';
import { deepFreeze } from '../testing';

function value<T, E>(result: Result<T, E>): T {
  if (!result.ok)
    throw new Error(
      `unexpected failure in test fixture: ${JSON.stringify(result.error)}`,
    );
  return result.value;
}

function iso(raw: string): CountryIso2 {
  return value(PhoneSystem.parseCountry(raw));
}

const BG = iso('BG');

/** What the template layer hands `listPhoneCountries`: one cached DisplayNames + Collator per locale. */
function namingFor(locale: string): CountryNaming {
  const names = new Intl.DisplayNames([locale], { type: 'region' });
  const collator = new Intl.Collator(locale);
  return {
    nameOf: (code) => names.of(code) ?? null,
    compare: (a, b) => collator.compare(a, b),
  };
}

// kernel phone-number.spec.ts
describe('PhoneSystem.parse', () => {
  it('accepts an already-E.164 number', () => {
    expect(PhoneSystem.parse('+359885550100', null)).toEqual({
      ok: true,
      value: { e164: '+359885550100', countryCallingCode: '359' },
    });
  });

  it('accepts a local-format number given its country', () => {
    expect(value(PhoneSystem.parse('0885550100', BG)).e164).toBe(
      '+359885550100',
    );
  });

  it('trims surrounding whitespace and accepts national grouping', () => {
    expect(value(PhoneSystem.parse('  088 555 0100 ', BG)).e164).toBe(
      '+359885550100',
    );
  });

  it('rejects garbage input with reason not-a-number', () => {
    expect(PhoneSystem.parse('not-a-phone', null)).toEqual({
      ok: false,
      error: {
        code: PhoneErrorCode.Invalid,
        attempted: 'not-a-phone',
        reason: PhoneInvalidReason.NotANumber,
      },
    });
  });

  it('rejects a number too short to be possible with reason too-short', () => {
    const result = PhoneSystem.parse('123', BG);
    expect(!result.ok && result.error).toEqual({
      code: 'phone.invalid',
      attempted: '123',
      reason: 'too-short',
    });
  });

  it('rejects an over-long number with reason too-long', () => {
    const result = PhoneSystem.parse('+3598855501001234567', null);
    expect(
      !result.ok &&
        result.error.code === PhoneErrorCode.Invalid &&
        result.error.reason,
    ).toBe('too-long');
  });

  it('rejects a local-format number without a country with reason invalid-country', () => {
    const result = PhoneSystem.parse('0885550100', null);
    expect(
      !result.ok &&
        result.error.code === PhoneErrorCode.Invalid &&
        result.error.reason,
    ).toBe('invalid-country');
  });

  it('rejects any text against a default country the metadata does not support', () => {
    const result = PhoneSystem.parse('+359885550100', CountryIso2.of('XX'));
    expect(!result.ok && result.error).toEqual({
      code: 'phone.invalid',
      attempted: '+359885550100',
      reason: 'invalid-country',
    });
  });

  it('falls back to reason invalid for a number that parses but is not valid', () => {
    // Right length for BG, but no BG range starts with 1.
    const result = PhoneSystem.parse('0123456789', BG);
    expect(
      !result.ok &&
        result.error.code === PhoneErrorCode.Invalid &&
        result.error.reason,
    ).toBe('invalid');
  });

  it('keeps the raw, untrimmed text as the i18n param', () => {
    const result = PhoneSystem.parse(' 123 ', BG);
    expect(!result.ok && result.error.attempted).toBe(' 123 ');
  });

  it('parses both spellings of one number to one E.164', () => {
    const a = value(PhoneSystem.parse('+359885550100', null));
    const b = value(PhoneSystem.parse('0885550100', BG));
    expect(E164.equals(a.e164, b.e164)).toBe(true);
  });
});

describe('PhoneSystem — derived views of a stored E.164', () => {
  const stored = E164.of('+359885550100');

  it('derives the country and the calling code from the prefix', () => {
    expect(PhoneSystem.countryOf(stored)).toBe('BG');
    expect(PhoneSystem.callingCode(stored)).toBe('359');
  });

  it('formats nationally and internationally while storage stays E.164', () => {
    expect(PhoneSystem.formatNational(stored)).toBe('088 555 0100');
    expect(PhoneSystem.formatInternational(stored)).toBe('+359 88 555 0100');
  });

  it('falls back to the stored value when the metadata cannot place it', () => {
    const unplaceable = E164.of('not-a-number');
    expect(PhoneSystem.countryOf(unplaceable)).toBeNull();
    expect(PhoneSystem.callingCode(unplaceable)).toBeNull();
    expect(PhoneSystem.formatNational(unplaceable)).toBe('not-a-number');
    expect(PhoneSystem.formatInternational(unplaceable)).toBe('not-a-number');
  });

  it('countryOf is null for a calling code shared by no single country', () => {
    // +800 is the international freephone code — no country owns it.
    expect(PhoneSystem.countryOf(E164.of('+80012345678'))).toBeNull();
  });
});

// kernel phone-country.spec.ts
describe('PhoneSystem.parseCountry', () => {
  it('accepts a supported uppercase ISO-2 code', () => {
    expect(PhoneSystem.parseCountry('BG')).toEqual({ ok: true, value: 'BG' });
  });

  it('normalises case and surrounding whitespace', () => {
    expect(PhoneSystem.parseCountry('  bg ')).toEqual({
      ok: true,
      value: 'BG',
    });
  });

  it('rejects an unassigned ISO-2 code', () => {
    expect(PhoneSystem.parseCountry('XX')).toEqual({
      ok: false,
      error: { code: PhoneErrorCode.CountryUnsupported, attempted: 'XX' },
    });
  });

  it('rejects strings that are not ISO-2 codes at all', () => {
    expect(PhoneSystem.parseCountry('').ok).toBe(false);
    expect(PhoneSystem.parseCountry('Bulgaria').ok).toBe(false);
  });
});

describe('PhoneSystem.countryCallingCode', () => {
  it("gives a country's dial code, digits only", () => {
    expect(PhoneSystem.countryCallingCode(BG)).toBe('359');
    expect(PhoneSystem.countryCallingCode(iso('US'))).toBe('1');
  });

  it('is null for a code the metadata does not support', () => {
    expect(PhoneSystem.countryCallingCode(CountryIso2.of('XX'))).toBeNull();
  });
});

describe('PhoneSystem.listPhoneCountries', () => {
  it('localizes names for an English locale and carries dial codes', () => {
    const bulgaria = PhoneSystem.listPhoneCountries(namingFor('en')).find(
      (c) => c.code === 'BG',
    );
    expect(bulgaria).toEqual({ code: 'BG', dialCode: '359', name: 'Bulgaria' });
  });

  it('localizes names for a Bulgarian locale', () => {
    const countries = PhoneSystem.listPhoneCountries(namingFor('bg'));
    expect(countries.find((c) => c.code === 'BG')?.name).toBe('България');
    expect(countries.find((c) => c.code === 'DE')?.name).toBe('Германия');
  });

  it('sorts by localized name with the locale collator', () => {
    for (const locale of ['en', 'bg']) {
      const collator = new Intl.Collator(locale);
      const names = PhoneSystem.listPhoneCountries(namingFor(locale)).map(
        (c) => c.name,
      );
      expect(names).toEqual([...names].sort((a, b) => collator.compare(a, b)));
    }
  });

  it('falls back to the ISO code when the platform cannot name a country', () => {
    const countries = PhoneSystem.listPhoneCountries({
      nameOf: (code) => (code === 'BG' ? null : `name-${code}`),
      compare: (a, b) => (a < b ? -1 : a > b ? 1 : 0),
    });
    expect(countries.find((c) => c.code === 'BG')?.name).toBe('BG');
    expect(countries.length).toBeGreaterThan(200);
  });
});

describe('PhoneSystem.formatDraft', () => {
  it('canonicalizes trunk-prefixed input to the significant form (owner ruling 2026-07-26)', () => {
    // The dial-code trigger already carries +359 — the trunk '0' is the
    // digit the dial code REPLACES, so it never renders: '0885550100' and
    // '885550100' both display '88 555 0100'.
    expect(PhoneSystem.formatDraft('0885550100', BG)).toEqual({
      formatted: '88 555 0100',
      country: 'BG',
      e164: '+359885550100',
      isValid: true,
      template: null,
    });
  });

  it('groups TRUNK-LESS national digits via the international form (owner report 2026-07-26)', () => {
    // '896330113' typed against BG without the leading 0 matches no national
    // as-you-type pattern — the draft still must group live ('89 633 0113')
    // and derive the right E.164, without inventing a 0 the user never typed.
    const draft = PhoneSystem.formatDraft('896330113', BG);
    expect(draft.formatted).toBe('89 633 0113');
    expect(draft.e164).toBe('+359896330113');
    expect(draft.isValid).toBe(true);
  });

  it('groups partial trunk-less digits too', () => {
    const draft = PhoneSystem.formatDraft('89633', BG);
    expect(draft.formatted).toBe('89 633');
    expect(draft.isValid).toBe(false);
  });

  it('re-detects the country when the text carries a +<dial code>', () => {
    // Autofill/paste of an international value must override the selected
    // country, never be rejected.
    const draft = PhoneSystem.formatDraft('+359885550100', iso('US'));
    expect(draft.country).toBe('BG');
    expect(draft.e164).toBe('+359885550100');
    expect(draft.isValid).toBe(true);
  });

  it('keeps e164 null and isValid false while the draft is partial', () => {
    const draft = PhoneSystem.formatDraft('088', BG);
    expect(draft.e164).toBeNull();
    expect(draft.isValid).toBe(false);
  });

  it('handles empty input without a country', () => {
    expect(PhoneSystem.formatDraft('', null)).toEqual({
      formatted: '',
      country: null,
      e164: null,
      isValid: false,
      template: null,
    });
  });

  it('carries the format mask of an international draft', () => {
    // One `x` per typed character, the `+` included.
    const draft = PhoneSystem.formatDraft('+3598855', null);
    expect(draft.formatted).toBe('+359 88 55');
    expect(draft.template).toBe('xxxx xx xx');
  });

  it('keeps the plain draft when the international pass adds no grouping', () => {
    // '88' is already its own significant form — nothing to adopt.
    expect(PhoneSystem.formatDraft('88', BG)).toEqual({
      formatted: '88',
      country: 'BG',
      e164: null,
      isValid: false,
      template: 'xx',
    });
  });

  it('leaves a single digit to the plain pass', () => {
    const draft = PhoneSystem.formatDraft('8', BG);
    expect(draft.formatted).toBe('8');
    expect(draft.isValid).toBe(false);
  });

  it('treats an unsupported country like none', () => {
    expect(PhoneSystem.formatDraft('0885550100', CountryIso2.of('XX'))).toEqual(
      PhoneSystem.formatDraft('0885550100', null),
    );
  });

  it('round-trips its E.164 through parse', () => {
    const draft = PhoneSystem.formatDraft('088 555 0100', BG);
    expect(draft.e164).not.toBeNull();
    expect(value(PhoneSystem.parse(draft.e164 ?? '', null)).e164).toBe(
      '+359885550100',
    );
  });
});

describe('PhoneSystem.example', () => {
  it('returns a significant-form example that validates for its country', () => {
    const example = PhoneSystem.example(BG);
    expect(example).not.toBeNull();
    // Trunk-less like the field display it placeholds for — validates
    // against the same country anchor.
    expect(example?.startsWith('0')).toBe(false);
    expect(PhoneSystem.parse(example ?? '', BG).ok).toBe(true);
  });

  it('returns examples per country in the canonical significant grouping', () => {
    // Same canonical form the draft renders (no national-format parens — one
    // display grammar next to the dial-code trigger).
    expect(PhoneSystem.example(iso('US'))).toBe('201 555 0123');
  });

  it('is null for a code the metadata does not support', () => {
    expect(PhoneSystem.example(CountryIso2.of('XX'))).toBeNull();
  });
});

describe('PhoneSystem purity', () => {
  it('is pure: same input → same output, inputs untouched', () => {
    const naming = deepFreeze(namingFor('bg'));
    expect(PhoneSystem.parse('0885550100', BG)).toEqual(
      PhoneSystem.parse('0885550100', BG),
    );
    expect(PhoneSystem.parse('123', BG)).toEqual(PhoneSystem.parse('123', BG));
    expect(PhoneSystem.formatDraft('08963', BG)).toEqual(
      PhoneSystem.formatDraft('08963', BG),
    );
    expect(PhoneSystem.example(BG)).toBe(PhoneSystem.example(BG));
    const once = PhoneSystem.listPhoneCountries(naming);
    const twice = PhoneSystem.listPhoneCountries(naming);
    expect(twice).toEqual(once);
    // A fresh array per call — the caller owns (and may memoise) it.
    expect(twice).not.toBe(once);
  });
});
