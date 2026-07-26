import { describe, expect, it } from 'vitest';
import {
  CountryIso2,
  examplePhoneNumber,
  formatPhoneDraft,
  listPhoneCountries,
  toCountryIso2,
} from './phone-country';
import { CountryUnsupportedError } from './phone-country.errors';
import { PhoneNumber } from './phone-number';

function iso(raw: string): CountryIso2 {
  const result = toCountryIso2(raw);
  if (result.isFailure()) {
    throw new Error(`test expects "${raw}" to be a supported country`);
  }
  return result.value;
}

describe('toCountryIso2', () => {
  it('accepts a supported uppercase ISO-2 code', () => {
    const result = toCountryIso2('BG');
    expect(result.isSuccess()).toBe(true);
    if (result.isSuccess()) {
      expect(result.value).toBe('BG');
    }
  });

  it('normalizes case and surrounding whitespace', () => {
    const result = toCountryIso2('  bg ');
    expect(result.isSuccess()).toBe(true);
    if (result.isSuccess()) {
      expect(result.value).toBe('BG');
    }
  });

  it('rejects an unassigned ISO-2 code', () => {
    const result = toCountryIso2('XX');
    expect(result.isFailure()).toBe(true);
    if (result.isFailure()) {
      expect(result.error).toBeInstanceOf(CountryUnsupportedError);
      expect(result.error.code).toBe('country_unsupported');
      expect(result.error.attempted).toBe('XX');
    }
  });

  it('rejects strings that are not ISO-2 codes at all', () => {
    expect(toCountryIso2('').isFailure()).toBe(true);
    expect(toCountryIso2('Bulgaria').isFailure()).toBe(true);
  });
});

describe('listPhoneCountries', () => {
  it('localizes names for an English locale and carries dial codes', () => {
    const countries = listPhoneCountries('en');
    const bulgaria = countries.find((c) => c.code === 'BG');
    expect(bulgaria).toBeDefined();
    expect(bulgaria?.name).toBe('Bulgaria');
    expect(bulgaria?.dialCode).toBe('359');
  });

  it('localizes names for a Bulgarian locale', () => {
    const countries = listPhoneCountries('bg');
    const bulgaria = countries.find((c) => c.code === 'BG');
    expect(bulgaria?.name).toBe('България');
    const germany = countries.find((c) => c.code === 'DE');
    expect(germany?.name).toBe('Германия');
  });

  it('sorts by localized name with the locale collator', () => {
    for (const locale of ['en', 'bg']) {
      const collator = new Intl.Collator(locale);
      const names = listPhoneCountries(locale).map((c) => c.name);
      expect(names).toEqual([...names].sort((a, b) => collator.compare(a, b)));
    }
  });

  it('memoizes per locale', () => {
    expect(listPhoneCountries('en')).toBe(listPhoneCountries('en'));
    expect(listPhoneCountries('en')).not.toBe(listPhoneCountries('bg'));
  });
});

describe('formatPhoneDraft', () => {
  it('canonicalizes trunk-prefixed input to the significant form (owner ruling 2026-07-26)', () => {
    // The dial-code trigger already carries +359 — the trunk '0' is the
    // digit the dial code REPLACES, so it never renders: '0885550100' and
    // '885550100' both display '88 555 0100'.
    const draft = formatPhoneDraft('0885550100', iso('BG'));
    expect(draft.formatted).toBe('88 555 0100');
    expect(draft.country).toBe('BG');
    expect(draft.e164).toBe('+359885550100');
    expect(draft.isValid).toBe(true);
  });

  it('groups TRUNK-LESS national digits via the international form (owner report 2026-07-26)', () => {
    // '896330113' typed against BG without the leading 0 matches no
    // national as-you-type pattern — the draft still must group live
    // ('89 633 0113') and derive the right E.164, without inventing a 0
    // the user never typed.
    const draft = formatPhoneDraft('896330113', iso('BG'));
    expect(draft.formatted).toBe('89 633 0113');
    expect(draft.e164).toBe('+359896330113');
    expect(draft.isValid).toBe(true);
  });

  it('groups partial trunk-less digits too', () => {
    const draft = formatPhoneDraft('89633', iso('BG'));
    expect(draft.formatted).toBe('89 633');
    expect(draft.isValid).toBe(false);
  });

  it('re-detects the country when the text carries a +<dial code>', () => {
    // Autofill/paste of an international value must override the selected
    // country, never be rejected.
    const draft = formatPhoneDraft('+359885550100', iso('US'));
    expect(draft.country).toBe('BG');
    expect(draft.e164).toBe('+359885550100');
    expect(draft.isValid).toBe(true);
  });

  it('keeps e164 undefined and isValid false while the draft is partial', () => {
    const draft = formatPhoneDraft('088', iso('BG'));
    expect(draft.e164).toBeUndefined();
    expect(draft.isValid).toBe(false);
  });

  it('handles empty input without a country', () => {
    const draft = formatPhoneDraft('');
    expect(draft.formatted).toBe('');
    expect(draft.country).toBeUndefined();
    expect(draft.e164).toBeUndefined();
    expect(draft.isValid).toBe(false);
    expect(draft.template).toBeUndefined();
  });

  it('round-trips its E.164 through PhoneNumber.create', () => {
    const draft = formatPhoneDraft('088 555 0100', iso('BG'));
    expect(draft.e164).toBeDefined();
    const result = PhoneNumber.create(draft.e164 ?? '');
    expect(result.isSuccess()).toBe(true);
    if (result.isSuccess()) {
      expect(result.value.value).toBe('+359885550100');
    }
  });
});

describe('examplePhoneNumber', () => {
  it('returns a significant-form example that validates for its country', () => {
    const example = examplePhoneNumber(iso('BG'));
    expect(example).toBeDefined();
    // Trunk-less like the field display it placeholds for — validates
    // against the same country anchor.
    expect(example?.startsWith('0')).toBe(false);
    const result = PhoneNumber.create(example ?? '', iso('BG'));
    expect(result.isSuccess()).toBe(true);
  });

  it('returns examples per country in the canonical significant grouping', () => {
    // Same canonical form the draft renders (no national-format parens —
    // one display grammar next to the dial-code trigger).
    expect(examplePhoneNumber(iso('US'))).toBe('201 555 0123');
  });
});
