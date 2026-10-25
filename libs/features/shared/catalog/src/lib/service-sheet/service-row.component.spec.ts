import { Component, Injectable, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  Translation,
  TranslocoLoader,
  provideTransloco,
} from '@jsverse/transloco';
import { Observable, of } from 'rxjs';
import { CompositionKind } from '@core/components';
import { BarberId, Currency, ServiceId } from '@core/primitives';
import { cents, duration } from '@core/testing';
import type { ServiceVm } from '../content/catalog.vm';
import { ServiceRowComponent } from './service-row.component';

const bg: Translation = {
  landing: {
    services: {
      openService: 'Отвори {{service}}',
      durationLabel: 'мин',
      bundle: 'Пакет',
    },
  },
};

@Injectable()
class Loader implements TranslocoLoader {
  getTranslation(): Observable<Translation> {
    return of(bg);
  }
}

const CUT: ServiceVm = {
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

const BUNDLE: ServiceVm = {
  ...CUT,
  id: ServiceId.of('svc-full-care'),
  compositionKind: CompositionKind.Bundle,
  name: { en: 'Full care', bg: 'Пълна грижа' },
  includes: [ServiceId.of('svc-classic-cut')],
};

@Component({
  imports: [ServiceRowComponent],
  template: `
    <div role="list">
      <cr-service-row
        [service]="service()"
        [price]="'от 21,50 €'"
        [minutes]="minutes()"
        (pressed)="pressed.set(pressed() + 1)"
      />
    </div>
  `,
})
class Host {
  readonly service = signal<ServiceVm>(BUNDLE);
  readonly minutes = signal<number | undefined>(55);
  readonly pressed = signal(0);
}

async function render() {
  await TestBed.configureTestingModule({
    imports: [Host],
    providers: [
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
  const fixture = TestBed.createComponent(Host);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  const root = fixture.nativeElement as HTMLElement;
  const row = (id: string): HTMLElement | null =>
    root.querySelector(`[data-testid="service-row-${id}"]`);
  return { fixture, host: fixture.componentInstance, root, row };
}

describe('ServiceRowComponent', () => {
  it('is one native button named for the service, the price its trailing value', async () => {
    const { row, host } = await render();
    const button = row('svc-full-care');
    expect(button?.tagName).toBe('BUTTON');
    expect(button?.getAttribute('aria-label')).toBe('Отвори Пълна грижа');
    expect(button?.hasAttribute('data-interactive')).toBe(true);
    expect(
      button?.querySelector('.service-row__name')?.textContent?.trim(),
    ).toBe('Пълна грижа');
    expect(
      button?.querySelector('.service-row__price')?.textContent?.trim(),
    ).toBe('от 21,50 €');
    button?.click();
    expect(host.pressed()).toBe(1);
  });

  it('marks a bundle with the glyph in the accent and the word in ink (the accent law)', async () => {
    const { row } = await render();
    const meta = row('svc-full-care')?.querySelector('.service-row__meta');
    expect(meta?.getAttribute('data-font')).toBe('footnote');
    expect(meta?.getAttribute('data-foreground-style')).toBe('secondary');

    const mark = meta?.querySelector('[data-testid="service-row-bundle"]');
    expect(mark?.textContent?.trim()).toBe('Пакет');
    // The word takes the primary ink back from the quiet line…
    expect(mark?.getAttribute('data-foreground-style')).toBe('primary');
    // …and the orange is the glyph's alone.
    const glyph = mark?.querySelector('ui-icon');
    expect(glyph?.getAttribute('data-name')).toBe('service.bundle');
    expect(glyph?.getAttribute('data-foreground-style')).toBe('accent');
    expect(
      row('svc-full-care')?.querySelectorAll(
        '[data-foreground-style="accent"]:not(ui-icon)',
      ),
    ).toHaveLength(0);
  });

  it('joins the duration and the mark with a dot, and drops the dot with the duration', async () => {
    const { row, host, fixture } = await render();
    // The line's parts, in order: each is a flex item of the quiet line.
    const parts = () =>
      [
        ...(row('svc-full-care')?.querySelector('.service-row__meta')
          ?.children ?? []),
      ].map((part) => part.textContent?.replace(/\s+/g, ' ').trim());
    expect(parts()).toEqual(['55 мин', '·', 'Пакет']);
    host.minutes.set(undefined);
    fixture.detectChanges();
    expect(parts()).toEqual(['Пакет']);
  });

  it('draws no mark on a single service', async () => {
    const { row, host, fixture, root } = await render();
    host.service.set(CUT);
    host.minutes.set(35);
    fixture.detectChanges();
    expect(root.querySelector('[data-testid="service-row-bundle"]')).toBeNull();
    expect(
      row('svc-classic-cut')
        ?.querySelector('.service-row__meta')
        ?.textContent?.replace(/\s+/g, ' ')
        .trim(),
    ).toBe('35 мин');
  });
});
