import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { EnvironmentProviders, Injectable } from '@angular/core';
import {
  Translation,
  TranslocoLoader,
  TranslocoService,
  provideTransloco,
} from '@jsverse/transloco';
import { Observable, of } from 'rxjs';
import {
  APPOINTMENT_READ_PORTS,
  AUTH_SESSION_PORTS,
  AVATAR_PORTS,
  CATALOG_PORTS,
  CLOCK_PORTS,
  DEFAULT_LOCATION_PORTS,
  INBOX_PORTS,
  LOCATION_LOAD_PORTS,
  POSITION_BODY_READ_PORTS,
  POSITION_READ_PORTS,
  PROFILE_PORTS,
} from '@creativo/infrastructure/firebase-app';
import { PositionStatus, WorkplaceMode } from '@core/components';
import type { Position, PositionBody, ShopLocation } from '@core/entities';
import type { PositionReadPorts } from '@core/ports';
import { LocationId } from '@core/primitives';
import {
  locationFixture,
  memoryAppointmentReadPorts,
  memoryCatalogReadPorts,
  memoryAuthSessionPorts,
  memoryAvatarPorts,
  memoryClockPorts,
  memoryDefaultLocationPorts,
  memoryInboxPorts,
  memoryLocationLoadPorts,
  memoryPositionBodyReadPorts,
  memoryPositionReadPorts,
  memoryProfilePorts,
  memoryProgramsWorld,
  positionOf,
  textFixture,
} from '@core/testing';
import { LanguageService } from '@creativo/features/shared/shell';
import { MarketingCareers } from './marketing-careers';

/** The two shops of a multi-shop tenant — «Център» (the default) and «Младост». */
const CENTER = locationFixture({ shortName: textFixture('Center', 'Център') });
const MLADOST = locationFixture({
  id: LocationId.of('loc-mladost'),
  shortName: textFixture('Mladost', 'Младост'),
  sortOrder: 1,
});

/**
 * The app's own `programs.status` and `programs.workplace` words for `lang` — read, never re-typed, so
 * the badge cases pin the catalogue's words (pass E, E-17; translated by
 * OR-53). Every other key renders as itself.
 */
function programStatusWords(lang: string): Translation {
  const file = resolve(
    __dirname,
    `../../../../../../infrastructure/i18n/src/assets/i18n/${lang}.json`,
  );
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- a fixed path to the app's own catalogue.
  const catalogue = JSON.parse(readFileSync(file, 'utf8')) as {
    readonly programs: {
      readonly status: Translation;
      readonly workplace: Translation;
      readonly careers: Translation;
    };
  };
  return {
    programs: {
      status: catalogue.programs.status,
      workplace: catalogue.programs.workplace,
      careers: catalogue.programs.careers,
    },
  };
}

@Injectable()
class TestTranslationLoader implements TranslocoLoader {
  getTranslation(lang: string): Observable<Translation> {
    return of(programStatusWords(lang));
  }
}

function provideTestI18n(): EnvironmentProviders[] {
  return provideTransloco({
    config: {
      availableLangs: ['bg', 'en'],
      defaultLang: 'en',
      fallbackLang: 'en',
      missingHandler: { logMissingKey: false },
    },
    loader: TestTranslationLoader,
  });
}

/**
 * The page's read, recorded: every status it asks for lands in `asked`, and
 * it answers EVERY seeded role (the memory double read unfiltered) — the
 * status filter is the adapter's query, pinned in its own spec, so a closed
 * role's badge can still be rendered here, as the legacy stub allowed.
 */
function recordedPositionReads(
  positions: readonly Position[],
  asked: (PositionStatus | null)[],
): PositionReadPorts {
  const reads = memoryPositionReadPorts(memoryProgramsWorld({ positions }));
  return {
    observePositions: (positionStatus) => {
      asked.push(positionStatus);
      return reads.observePositions(null);
    },
  };
}

async function configure(
  open: readonly Position[],
  asked: (PositionStatus | null)[] = [],
  shops: readonly ShopLocation[] = [locationFixture()],
  positionBodies: readonly PositionBody[] = [],
): Promise<ComponentFixture<MarketingCareers>> {
  document.documentElement.setAttribute('data-theme', 'light');
  await TestBed.configureTestingModule({
    imports: [MarketingCareers],
    providers: [
      provideRouter([]),
      ...provideTestI18n(),
      {
        provide: POSITION_READ_PORTS,
        useValue: recordedPositionReads(open, asked),
      },
      // The descriptions, read when a role is opened.
      {
        provide: POSITION_BODY_READ_PORTS,
        useValue: memoryPositionBodyReadPorts(
          memoryProgramsWorld({ positionBodies }),
        ),
      },
      // The catalogue's ACTIVE shops, which a scoped role names at a
      // multi-shop tenant.
      {
        provide: CATALOG_PORTS,
        useValue: memoryCatalogReadPorts({ locations: shops }),
      },
      // An anonymous visitor: the session double's default principal.
      { provide: AUTH_SESSION_PORTS, useValue: memoryAuthSessionPorts() },
      // The shared header's account circle reads its photo off the
      // session identity — no avatar for an anonymous visitor.
      { provide: AVATAR_PORTS, useValue: memoryAvatarPorts() },
      // The shared session model behind that chrome reads the profile.
      { provide: PROFILE_PORTS, useValue: memoryProfilePorts(new Map()) },
      // …and its menu counts upcoming visits.
      {
        // The shell menu's notifications row reads the inbox.
        provide: INBOX_PORTS,
        useValue: memoryInboxPorts(new Map()),
      },
      {
        provide: APPOINTMENT_READ_PORTS,
        useValue: memoryAppointmentReadPorts([]),
      },
      // …and its schedule row names the default location's shop day.
      {
        provide: LOCATION_LOAD_PORTS,
        useValue: memoryLocationLoadPorts(
          memoryProgramsWorld({ locations: [locationFixture()] }),
        ),
      },
      {
        provide: DEFAULT_LOCATION_PORTS,
        useValue: memoryDefaultLocationPorts(),
      },
      // The shell reads the injected clock (the menu's day, the footer's year).
      { provide: CLOCK_PORTS, useValue: memoryClockPorts() },
    ],
  }).compileComponents();

  return TestBed.createComponent(MarketingCareers);
}

/**
 * Renders in `lang`. The shell's language service applies its own default
 * (`bg`) when the chrome first creates it — in the app, long before a row
 * arrives; here the memory read answers in the same pass — so it is booted
 * first and the visitor's language is applied after it.
 */
async function render(
  fixture: ComponentFixture<MarketingCareers>,
  lang: 'en' | 'bg' = 'en',
): Promise<HTMLElement> {
  TestBed.inject(LanguageService);
  TestBed.inject(TranslocoService).setActiveLang(lang);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return fixture.nativeElement;
}

describe('MarketingCareers', () => {
  it('renders the real site header (solid, no hero) and footer', async () => {
    const fixture = await configure([]);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const host: HTMLElement = fixture.nativeElement;
    expect(host.querySelector('[data-page-shell]')).not.toBeNull();
    const header = host.querySelector('[data-testid="site-header"]');
    expect(header?.getAttribute('data-view')).toBe('solid');
    expect(host.querySelector('[data-testid="site-footer"]')).not.toBeNull();
  });

  it('shows the empty state with an Instagram fallback when there are no open positions', async () => {
    const fixture = await configure([]);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const host: HTMLElement = fixture.nativeElement;
    expect(host.querySelector('[data-testid="careers-empty"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="careers-list"]')).toBeNull();
  });

  /** The page with its first role tapped: the role's sheet is up. */
  async function openFirstRole(
    fixture: Awaited<ReturnType<typeof configure>>,
  ): Promise<HTMLElement> {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const host: HTMLElement = fixture.nativeElement;
    host.querySelector<HTMLElement>('[data-testid="careers-role"]')?.click();
    fixture.detectChanges();
    return host;
  }
  /** The sheet's ways to answer, each as `[href, target]`. */
  const waysOf = (host: HTMLElement) =>
    Array.from(
      host.querySelectorAll('[data-testid^="contact-link-"]'),
      (link) => [link.getAttribute('href'), link.getAttribute('target')],
    );

  it('lists one row per open role, each a door to the role and none a status capsule', async () => {
    const asked: (PositionStatus | null)[] = [];
    const fixture = await configure([positionOf('pos_1')], asked);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const host: HTMLElement = fixture.nativeElement;
    const rows = host.querySelectorAll(
      '[data-testid="careers-list"] button[data-testid="careers-role"]',
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.getAttribute('aria-haspopup')).toBe('dialog');
    expect(
      host.querySelector('[data-testid="careers-list"] [uibadge]'),
    ).toBeNull();
    expect(host.querySelector('[data-testid="contact-sheet"]')).toBeNull();
    // The page asks for open roles only — once.
    expect(asked).toEqual([PositionStatus.Open]);
  });

  it('opens the role: its name, where it is worked, its words in full, and every way to answer', async () => {
    const host = await openFirstRole(
      await configure(
        [
          positionOf('pos_1', {
            summary: textFixture('Five days a week.', 'Пет дни в седмицата.'),
            locationIds: [CENTER.id],
            contacts: [
              { contactMethod: 'PHONE', contactValue: '+359888123456' },
              { contactMethod: 'EMAIL', contactValue: 'jobs@example.test' },
              { contactMethod: 'INSTAGRAM', contactValue: 'creativo' },
              {
                contactMethod: 'LINK',
                contactValue: 'https://example.com/apply',
              },
            ],
          }),
        ],
        [],
        [CENTER, MLADOST],
      ),
    );

    const sheet = host.querySelector('[data-testid="contact-sheet"]');
    expect(sheet?.querySelector('h2')?.textContent?.trim()).toBe('Barber');
    expect(
      sheet
        ?.querySelector('[data-testid="contact-sheet-where"]')
        ?.textContent?.replace(/\s+/g, ' ')
        .trim(),
    ).toBe('Center');
    expect(
      sheet
        ?.querySelector('[data-testid="contact-sheet-summary"]')
        ?.textContent?.trim(),
    ).toBe('Five days a week.');
    // A call or a mail is handed to the device; a web address opens beside.
    expect(waysOf(host)).toEqual([
      ['tel:+359888123456', null],
      ['mailto:jobs@example.test', null],
      ['https://www.instagram.com/creativo', '_blank'],
      ['https://example.com/apply', '_blank'],
    ]);
  });

  it('draws the role’s description under its summary once it is read, in the visitor’s language', async () => {
    const role = positionOf('pos_1');
    const fixture = await configure(
      [role],
      [],
      [locationFixture()],
      [
        {
          id: role.id,
          body: textFixture(
            '# What you do\n\n- **Fades**\n- Beards',
            '# Какво правиш\n\n- **Фейд**\n- Бради',
          ),
        },
      ],
    );
    const host = await openFirstRole(fixture);
    await fixture.whenStable();
    fixture.detectChanges();

    const body = host.querySelector('[data-testid="contact-sheet-body"]');
    const heading = body?.querySelector('[role="heading"]');
    expect(heading?.textContent?.trim()).toBe('What you do');
    // Under the sheet's own h2.
    expect(heading?.getAttribute('aria-level')).toBe('3');
    expect(
      Array.from(
        body?.querySelectorAll('li') ?? [],
        (item) => item.textContent,
      ),
    ).toEqual(['Fades', 'Beards']);
    expect(body?.querySelector('strong')?.textContent).toBe('Fades');
    // Between the summary and the ways to answer.
    const summary = host.querySelector('[data-testid="contact-sheet-summary"]');
    const ways = host.querySelector('.cr-contact-sheet__ways');
    expect(summary?.nextElementSibling).toBe(body);
    expect(body?.nextElementSibling).toBe(ways);
  });

  it('opens a role with no description as it always did: no body is drawn', async () => {
    const fixture = await configure([positionOf('pos_1')]);
    const host = await openFirstRole(fixture);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(host.querySelector('[data-testid="contact-sheet"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="contact-sheet-body"]')).toBeNull();
    expect(host.querySelector('ui-rich-text')).toBeNull();
  });

  it("answers a role with no way of its own through the shop's Instagram", async () => {
    const host = await openFirstRole(await configure([positionOf('pos_1')]));

    expect(waysOf(host)).toEqual([
      ['https://instagram.com/creativo.barbershop', '_blank'],
    ]);
  });

  it("opens on the site's own heading — the title and the lede, no eyebrow over them", async () => {
    const host = await render(await configure([positionOf('pos_1')]));

    const header = host.querySelector('ui-section-header');
    expect(header?.querySelector('h1[uititle]')?.textContent?.trim()).toBe(
      'Come work the other side of the chair.',
    );
    expect(header?.querySelector('[uilede]')).not.toBeNull();
    expect(host.querySelector('[uieyebrow]')).toBeNull();
  });

  it('numbers nothing: a role is its words, not a figure', async () => {
    const host = await render(
      await configure([
        positionOf('pos_1'),
        positionOf('pos_2', { sortOrder: 1 }),
      ]),
    );

    expect(
      Array.from(host.querySelectorAll('[data-testid="careers-role"]'), (row) =>
        /\d/.test(row.textContent ?? ''),
      ),
    ).toEqual([false, false]);
  });

  it("closes on the way in for whoever found no role: the shop's Instagram", async () => {
    const host = await render(await configure([positionOf('pos_1')]));

    const closer = host.querySelector('[data-testid="careers-closer"]');
    expect(closer?.querySelector('h2')?.textContent?.trim()).toBe(
      "Don't see your role?",
    );
    expect(closer?.querySelector('a')?.getAttribute('href')).toBe(
      'https://instagram.com/creativo.barbershop',
    );
  });

  it('prints the title and summary in the active language', async () => {
    const en = await render(await configure([positionOf('pos_1')]), 'en');
    const enRow = en.querySelector('[data-testid="careers-role"]');
    expect(enRow?.textContent).toContain('Barber');
    expect(enRow?.textContent).toContain('Full-time chair');
    TestBed.resetTestingModule();

    const bg = await render(await configure([positionOf('pos_1')]), 'bg');
    const bgRow = bg.querySelector('[data-testid="careers-role"]');
    expect(bgRow?.textContent).toContain('Бръснар');
    expect(bgRow?.textContent).toContain('Пълен работен ден');
  });

  // OR-42: at a multi-shop tenant a role scoped to some shops names them
  // under its summary; a role open at every shop names none.
  it('names the shops a scoped role is open at, at a multi-shop tenant', async () => {
    const host = await render(
      await configure(
        [
          positionOf('pos_scoped', {
            locationIds: [MLADOST.id, CENTER.id],
          }),
          positionOf('pos_everywhere', { sortOrder: 1 }),
        ],
        [],
        [CENTER, MLADOST],
      ),
      'bg',
    );

    const rows = host.querySelectorAll('[data-testid="careers-role"]');
    expect(
      rows[0]
        ?.querySelector('[data-testid="careers-row-shops"]')
        ?.textContent?.trim(),
    ).toBe('Център · Младост');
    expect(
      rows[1]?.querySelector('[data-testid="careers-row-shops"]'),
    ).toBeNull();
  });

  it('words a remote role and a hybrid one before its shops', async () => {
    const host = await render(
      await configure(
        [
          positionOf('pos_remote', { workplaceMode: WorkplaceMode.Remote }),
          positionOf('pos_hybrid', {
            workplaceMode: WorkplaceMode.Hybrid,
            locationIds: [CENTER.id],
            sortOrder: 1,
          }),
        ],
        [],
        [CENTER, MLADOST],
      ),
      'bg',
    );

    const rows = host.querySelectorAll('[data-testid="careers-role"]');
    const placeOf = (row: Element | undefined) =>
      row
        ?.querySelector('[data-testid="careers-row-workplace"]')
        ?.parentElement?.textContent?.replace(/\s+/g, ' ')
        .trim();
    expect(placeOf(rows[0])).toBe('От вкъщи');
    expect(placeOf(rows[1])).toBe('Хибридно · Център');
  });

  it('names no shop at a one-shop tenant', async () => {
    const host = await render(
      await configure([positionOf('pos_scoped', { locationIds: [CENTER.id] })]),
    );

    expect(host.querySelector('[data-testid="careers-row-shops"]')).toBeNull();
  });
});
