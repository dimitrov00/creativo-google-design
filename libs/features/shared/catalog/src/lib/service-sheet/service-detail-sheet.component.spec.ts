import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import {
  Translation,
  TranslocoLoader,
  provideTransloco,
} from '@jsverse/transloco';
import { Injectable } from '@angular/core';
import { Observable, of } from 'rxjs';
import { ServiceDetailSheetComponent } from './service-detail-sheet.component';
import type { BarberVm, ServiceVm } from '../content/catalog-vm';

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
  id: 'svc-classic-cut',
  kind: 'single',
  name: { en: 'Classic cut', bg: 'Класическа подстрижка' },
  description: { en: 'A precise cut.', bg: 'Прецизна подстрижка.' },
  variants: [],
  offerings: [{ barberId: 'ivan', base: { price: 14.5, minutes: 35 } }],
  upsellOnly: false,
  gallery: [],
};

const BARBERS: readonly BarberVm[] = [
  {
    id: 'ivan',
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

async function render(host: typeof OverridingHost | typeof DefaultHost) {
  await TestBed.configureTestingModule({
    imports: [host],
    providers: [
      provideRouter([]),
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
