import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Money } from '@core/components';
import { Currency } from '@core/primitives';
import { cents } from '@core/testing';
import { LanguageService } from '@creativo/features/shared/shell';
import { CatalogWording } from './catalog-wording.service';

/** Intl's no-break spaces as plain ones, so a line reads as typed. */
const plain = (text: string): string => text.replace(/[\u202f\u00a0]/g, ' ');

function wordingIn(lang: 'bg' | 'en'): CatalogWording {
  TestBed.configureTestingModule({
    providers: [
      { provide: LanguageService, useValue: { activeLang: signal(lang) } },
    ],
  });
  return TestBed.inject(CatalogWording);
}

/**
 * The retired EUR-only money formatter of `catalog.presenter.ts`, verbatim
 * (deleted in pass D): the bytes every EUR price keeps.
 */
function retiredFormatPrice(major: number, locale: string): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: 'EUR',
  }).format(major);
}

describe('CatalogWording.price — the one money formatter, at the catalogue locale', () => {
  it.each([
    ['bg', 2800, '28,00 €'],
    ['bg', 1450, '14,50 €'],
    ['en', 2800, '€28.00'],
    ['en', 1450, '€14.50'],
  ] as const)(
    'words an EUR price in %s byte-identical to the retired formatter (%i cents)',
    (lang, amount, words) => {
      const line = wordingIn(lang).price(
        Money.fromCents(cents(amount), Currency.EUR),
      );
      expect(line).toBe(retiredFormatPrice(amount / 100, lang));
      expect(plain(line)).toBe(words);
    },
  );

  // DEP-19: a price is worded in its stored currency. The retired formatter
  // hard-coded EUR, so this amount printed «28,00 €».
  it('words a price in its own stored currency (DEP-19)', () => {
    const line = wordingIn('bg').price(
      Money.fromCents(cents(2800), Currency.BGN),
    );
    expect(plain(line)).toBe('28,00 лв.');
    expect(line).not.toBe(retiredFormatPrice(28, 'bg'));
  });
});
