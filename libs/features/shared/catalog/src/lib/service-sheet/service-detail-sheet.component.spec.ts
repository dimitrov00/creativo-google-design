import { Component, signal, type Type } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import {
  Translation,
  TranslocoLoader,
  provideTransloco,
} from '@jsverse/transloco';
import { Injectable } from '@angular/core';
import { Observable, of } from 'rxjs';
import {
  CATALOG_PORTS,
  MEDIA_RESOLVE_PORTS,
} from '@creativo/infrastructure/firebase-app';
import { ServiceDetailSheetComponent } from './service-detail-sheet.component';
import { CompositionKind, ServiceComposition } from '@core/components';
import type { Service } from '@core/entities';
import { BarberId, Currency, ServiceId } from '@core/primitives';
import {
  cents,
  duration,
  memoryCatalogReadPorts,
  memoryMediaResolvePorts,
  serviceFixture,
  termsFixture,
} from '@core/testing';
import type { BarberVm, ServiceVm } from '../content/catalog.vm';

const bg: Translation = {
  landing: {
    services: {
      from: 'от',
      book: 'Запази час',
      bookService: 'Запази {{service}}',
      variantsLabel: 'Опции',
      includesLabel: 'Включва',
      whoLabel: 'Кой и цена',
      priceList: 'Ценоразпис',
      allBarbers: 'Всички бръснари',
      nBarbers: '{{count}} бръснари',
      openService: 'Отвори {{service}}',
      bookWithBarber: 'Запази при {{barber}}',
      bookServiceWith: 'Запази {{service}} при {{barber}}',
      goToPhoto: 'Снимка {{index}}',
      savings: 'Спестяваш {{amount}}',
      bundle: 'Пакет',
      durationLabel: 'мин',
      offeredBy: 'Услуги при {{barber}}',
    },
    nav: { close: 'Затвори', back: 'Назад' },
  },
  marketing: {
    servicesPage: { galleryLabel: 'Галерия' },
    gallery: { gridView: 'Решетка', carouselView: 'Лента' },
  },
};

@Injectable()
class Loader implements TranslocoLoader {
  getTranslation(): Observable<Translation> {
    return of(bg);
  }
}

const SERVICE: ServiceVm = {
  id: ServiceId.of('svc-classic-cut'),
  compositionKind: CompositionKind.Single,
  name: { en: 'Classic cut', bg: 'Класическа подстрижка' },
  description: { en: 'A precise cut.', bg: 'Прецизна подстрижка.' },
  variants: [],
  offerings: [
    {
      barberId: BarberId.of('ivan'),
      base: {
        priceCents: cents(1450),
        currency: Currency.EUR,
        minutes: duration(35),
      },
    },
  ],
  upsellOnly: false,
  gallery: [],
  currency: Currency.EUR,
  priceFromCents: cents(1450),
  cardPrice: { cheapestCents: cents(1450), spread: false },
  minutesRange: { min: duration(35), max: duration(35) },
};

const BARBERS: readonly BarberVm[] = [
  {
    id: BarberId.of('ivan'),
    name: { en: 'Ivan Kolev', bg: 'Иван Колев' },
    title: { en: 'Chief barber', bg: 'Главен бръснар' },
    bio: { en: 'Twelve years.', bg: 'Дванадесет години.' },
    avatarSrc: '/barbers/ivan.jpg',
    objectPosition: '50% 25%',
    specialty: { en: 'Scissors', bg: 'Ножица' },
    gallery: [],
  },
];

/** A host that overrides the docked action, exactly as onboarding does. */
@Component({
  imports: [ServiceDetailSheetComponent],
  template: `
    <cr-service-detail-sheet [service]="service()" [barbers]="barbers()">
      <button sheet-actions type="button" data-testid="host-action">
        Избери
      </button>
    </cr-service-detail-sheet>
  `,
})
class OverridingHost {
  readonly service = signal(SERVICE);
  readonly barbers = signal(BARBERS);
}

/** A host that projects nothing — the marketing default should stand in. */
@Component({
  imports: [ServiceDetailSheetComponent],
  template: `<cr-service-detail-sheet
    [service]="service()"
    [barbers]="barbers()"
  />`,
})
class DefaultHost {
  readonly service = signal(SERVICE);
  readonly barbers = signal(BARBERS);
}

/**
 * The stored twin of a fixture view model — the catalogue entity the sheet
 * asks `CatalogPricingSystem` about (performers, the bundle saving): Ivan
 * offers it at `priceCents` / `minutes`, which are also its own terms.
 */
function stored(
  id: string,
  priceCents: number,
  minutes: number,
  parts: readonly string[] = [],
): Service {
  const terms = termsFixture(priceCents, minutes);
  return serviceFixture({
    id: ServiceId.of(id),
    ...terms,
    offerings: [{ barberId: BarberId.of('ivan'), overrides: [], ...terms }],
    ...(parts.length > 0
      ? ServiceComposition.bundle(parts.map((part) => ServiceId.of(part)))
      : ServiceComposition.single()),
  });
}

/** The live catalogue behind the fixtures below — their entity twins. */
const CATALOG: readonly Service[] = [
  stored('svc-classic-cut', 1450, 35),
  stored('svc-shave', 1200, 25),
  stored('svc-full-care', 2150, 55, ['svc-classic-cut', 'svc-shave']),
  stored('svc-wash', 110, 10),
  stored('svc-trim', 220, 15),
  stored('svc-wash-trim', 330, 25, ['svc-wash', 'svc-trim']),
];

async function render(host: Type<unknown>) {
  await TestBed.configureTestingModule({
    imports: [host],
    providers: [
      provideRouter([]),
      {
        provide: CATALOG_PORTS,
        useValue: memoryCatalogReadPorts({ services: CATALOG }),
      },
      { provide: MEDIA_RESOLVE_PORTS, useValue: memoryMediaResolvePorts() },
      ...provideTransloco({
        config: {
          availableLangs: ['bg', 'en'],
          defaultLang: 'bg',
          fallbackLang: 'bg',
          missingHandler: { logMissingKey: false },
        },
        loader: Loader,
      }),
    ],
  }).compileComponents();
  const fixture = TestBed.createComponent(host);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

describe('ServiceDetailSheetComponent — the [sheet-actions] contract', () => {
  it('falls back to the marketing Book CTA when a host projects nothing', async () => {
    const host = await render(DefaultHost);
    const cta = host.querySelector('[data-testid="catalog-sheet-book"]');
    expect(cta).not.toBeNull();
    // Chained projection: the fallback has to reach the INNER sheet's
    // docked bar, not just render somewhere in the composite.
    expect(cta?.closest('ui-sheet-action-bar')).not.toBeNull();
  });

  it('lets a host replace the docked action entirely', async () => {
    const host = await render(OverridingHost);
    const own = host.querySelector('[data-testid="host-action"]');
    expect(own).not.toBeNull();
    expect(own?.closest('ui-sheet-action-bar')).not.toBeNull();
    // The default must be GONE, not stacked underneath it.
    expect(host.querySelector('[data-testid="catalog-sheet-book"]')).toBeNull();
  });

  it('renders the same body for both hosts — only the action differs', async () => {
    const withOverride = await render(OverridingHost);
    const overrideText = withOverride.textContent ?? '';
    TestBed.resetTestingModule();
    const withDefault = await render(DefaultHost);
    const defaultText = withDefault.textContent ?? '';

    for (const shared of ['Класическа подстрижка', 'Иван Колев']) {
      expect(overrideText).toContain(shared);
      expect(defaultText).toContain(shared);
    }
  });
});

/*
 * THE ACCENT LAW ON THE SHEET'S HEAD (2026-09-29): one orange; colour is a
 * shape, words are ink. A bundle's mark and its saving wear the accent as
 * THINGS — a wash capsule led by an accent glyph — and never as tinted
 * small words.
 */
const SHAVE: ServiceVm = {
  ...SERVICE,
  id: ServiceId.of('svc-shave'),
  name: { en: 'Shave', bg: 'Бръснене' },
  offerings: [
    {
      barberId: BarberId.of('ivan'),
      base: {
        priceCents: cents(1200),
        currency: Currency.EUR,
        minutes: duration(25),
      },
    },
  ],
  priceFromCents: cents(1200),
  cardPrice: { cheapestCents: cents(1200), spread: false },
  minutesRange: { min: duration(25), max: duration(25) },
};

const BUNDLE: ServiceVm = {
  ...SERVICE,
  id: ServiceId.of('svc-full-care'),
  compositionKind: CompositionKind.Bundle,
  name: { en: 'Full care', bg: 'Пълна грижа' },
  includes: [ServiceId.of('svc-classic-cut'), ServiceId.of('svc-shave')],
  offerings: [
    {
      barberId: BarberId.of('ivan'),
      base: {
        priceCents: cents(2150),
        currency: Currency.EUR,
        minutes: duration(55),
      },
    },
  ],
  priceFromCents: cents(2150),
  cardPrice: { cheapestCents: cents(2150), spread: false },
  minutesRange: { min: duration(55), max: duration(55) },
};

@Component({
  imports: [ServiceDetailSheetComponent],
  template: `<cr-service-detail-sheet
    [service]="service()"
    [barbers]="barbers()"
    [catalogServices]="catalog()"
  />`,
})
class BundleHost {
  readonly service = signal(BUNDLE);
  readonly barbers = signal(BARBERS);
  readonly catalog = signal<readonly ServiceVm[]>([SERVICE, SHAVE, BUNDLE]);
}

const WASH: ServiceVm = {
  ...SERVICE,
  id: ServiceId.of('svc-wash'),
  name: { en: 'Wash', bg: 'Измиване' },
  offerings: [
    {
      barberId: BarberId.of('ivan'),
      base: {
        priceCents: cents(110),
        currency: Currency.EUR,
        minutes: duration(10),
      },
    },
  ],
  priceFromCents: cents(110),
  cardPrice: { cheapestCents: cents(110), spread: false },
  minutesRange: { min: duration(10), max: duration(10) },
};

const TRIM: ServiceVm = {
  ...SERVICE,
  id: ServiceId.of('svc-trim'),
  name: { en: 'Trim', bg: 'Оформяне' },
  offerings: [
    {
      barberId: BarberId.of('ivan'),
      base: {
        priceCents: cents(220),
        currency: Currency.EUR,
        minutes: duration(15),
      },
    },
  ],
  priceFromCents: cents(220),
  cardPrice: { cheapestCents: cents(220), spread: false },
  minutesRange: { min: duration(15), max: duration(15) },
};

const WASH_TRIM: ServiceVm = {
  ...SERVICE,
  id: ServiceId.of('svc-wash-trim'),
  compositionKind: CompositionKind.Bundle,
  name: { en: 'Wash and trim', bg: 'Измиване и оформяне' },
  includes: [ServiceId.of('svc-wash'), ServiceId.of('svc-trim')],
  offerings: [
    {
      barberId: BarberId.of('ivan'),
      base: {
        priceCents: cents(330),
        currency: Currency.EUR,
        minutes: duration(25),
      },
    },
  ],
  priceFromCents: cents(330),
  cardPrice: { cheapestCents: cents(330), spread: false },
  minutesRange: { min: duration(25), max: duration(25) },
};

@Component({
  imports: [ServiceDetailSheetComponent],
  template: `<cr-service-detail-sheet
    [service]="service()"
    [barbers]="barbers()"
    [catalogServices]="catalog()"
  />`,
})
class ExactSumBundleHost {
  readonly service = signal(WASH_TRIM);
  readonly barbers = signal(BARBERS);
  readonly catalog = signal<readonly ServiceVm[]>([WASH, TRIM, WASH_TRIM]);
}

describe('ServiceDetailSheetComponent — a bundle under the accent law', () => {
  const byId = (host: HTMLElement, id: string): HTMLElement | null =>
    host.querySelector(`[data-testid="${id}"]`);

  it('marks a bundle with the accent capsule, its glyph drawn by the badge itself', async () => {
    const host = await render(BundleHost);
    const mark = byId(host, 'catalog-sheet-bundle');
    expect(mark?.classList.contains('ui-badge')).toBe(true);
    expect(mark?.getAttribute('data-tone')).toBe('accent');
    expect(mark?.textContent?.trim()).toBe('Пакет');
    // ONE glyph grammar: the badge's own, never a hand-projected icon.
    const glyphs = mark?.querySelectorAll('ui-icon') ?? [];
    expect(glyphs).toHaveLength(1);
    expect(glyphs[0]?.classList.contains('ui-badge__glyph')).toBe(true);
    expect(glyphs[0]?.getAttribute('data-name')).toBe('service.bundle');
  });

  it('states the saving as an accent capsule led by the price tag, its words in ink', async () => {
    const host = await render(BundleHost);
    const saving = byId(host, 'catalog-sheet-savings');
    expect(saving?.classList.contains('ui-badge')).toBe(true);
    expect(saving?.getAttribute('data-tone')).toBe('accent');
    expect(saving?.getAttribute('data-prominence')).toBe('standard');
    // 14,50 + 12,00 apart, 21,50 together.
    expect(saving?.textContent?.replace(/[\u202f\u00a0]/g, ' ').trim()).toBe(
      'Спестяваш 5,00 €',
    );
    const glyph = saving?.querySelector('ui-icon');
    expect(glyph?.classList.contains('ui-badge__glyph')).toBe(true);
    expect(glyph?.getAttribute('data-name')).toBe('promo.sum');
    expect(glyph?.getAttribute('aria-hidden')).toBe('true');
    // On a line of its own, UNDER the two facts: beside them it ran past
    // a 330 phone and every fact on the row wrapped.
    const facts = byId(host, 'catalog-sheet-facts');
    expect(facts?.getAttribute('data-axis')).toBe('horizontal');
    expect(facts?.childElementCount).toBe(2);
    expect(facts?.contains(saving ?? null)).toBe(false);
    expect(facts?.nextElementSibling).toBe(saving);
    expect(saving?.parentElement?.getAttribute('data-axis')).toBe('vertical');
    // No tinted small words anywhere in the head.
    expect(saving?.hasAttribute('data-foreground-style')).toBe(false);
    expect(
      host.querySelector(
        '[data-foreground-style="accent"]:not(ui-icon), [data-foreground-style="promo"]:not(ui-icon)',
      ),
    ).toBeNull();
  });

  it('says nothing of a saving, and draws no mark, on a single service', async () => {
    const host = await render(DefaultHost);
    expect(byId(host, 'catalog-sheet-bundle')).toBeNull();
    expect(byId(host, 'catalog-sheet-savings')).toBeNull();
  });

  it('lists the bundle’s members as rows a tap away', async () => {
    const host = await render(BundleHost);
    expect(byId(host, 'service-row-svc-classic-cut')).not.toBeNull();
    expect(byId(host, 'service-row-svc-shave')).not.toBeNull();
  });

  // DEP-10: the saving is whole cents. 1,10 + 2,20 apart and 3,30 together
  // saves nothing — the float sum (3.3000000000000003) printed a
  // «Спестяваш 0,00 €» capsule.
  it('says nothing of a saving on a bundle priced exactly at its members’ sum', async () => {
    const host = await render(ExactSumBundleHost);
    expect(byId(host, 'catalog-sheet-bundle')).not.toBeNull();
    expect(byId(host, 'catalog-sheet-savings')).toBeNull();
  });
});

/*
 * PASS D, DEP-19: the sheet words a price in the service's STORED currency.
 * The retired formatter hard-coded EUR, so an EUR service reads exactly as
 * before and a BGN-priced one now prints its own «лв.» (was «€»).
 */
@Component({
  imports: [ServiceDetailSheetComponent],
  template: `<cr-service-detail-sheet
    [service]="service()"
    [barbers]="barbers()"
  />`,
})
class BgnHost {
  readonly service = signal<ServiceVm>({ ...SERVICE, currency: Currency.BGN });
  readonly barbers = signal(BARBERS);
}

describe('ServiceDetailSheetComponent — prices in the stored currency (DEP-19)', () => {
  const fromPrice = (host: HTMLElement): string | undefined =>
    host
      .querySelector('.service-sheet__summary-price')
      ?.textContent?.replace(/[\u202f\u00a0]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

  it('words an EUR service’s "from" price exactly as before', async () => {
    const host = await render(DefaultHost);
    expect(fromPrice(host)).toBe('от 14,50 €');
  });

  it('words a BGN-priced service in its own currency', async () => {
    const host = await render(BgnHost);
    expect(fromPrice(host)).toBe('от 14,50 лв.');
  });
});
