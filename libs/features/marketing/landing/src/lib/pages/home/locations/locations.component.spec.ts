import { TestBed } from '@angular/core/testing';
import { onTestFinished, vi } from 'vitest';
import { MAPLIBRE_SOURCES, type MapLibreSources } from '@creativo/ui/controls';
import { CLOCK_PORTS } from '@creativo/infrastructure/firebase-app';
import type { UtcEpochMs } from '@core/primitives';
import { memoryClockPorts, utcMs } from '@core/testing';
import {
  provideTestCatalog,
  provideTestI18n,
} from '@creativo/features/marketing/landing/testing';
import { LocationsComponent } from './locations.component';

describe('LocationsComponent', () => {
  it('renders every location as an explorable card and opens its detail sheet', async () => {
    await TestBed.configureTestingModule({
      imports: [LocationsComponent],
      providers: [
        ...provideTestI18n(),
        ...provideTestCatalog(),
        { provide: CLOCK_PORTS, useValue: memoryClockPorts() },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(LocationsComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    const host: HTMLElement = fixture.nativeElement;

    expect(host.querySelectorAll('.location-card').length).toBe(2);
    expect(
      host.querySelectorAll(
        '.location-card[role="button"][aria-haspopup="dialog"]',
      ).length,
    ).toBe(2);
    // Maps place-card register: a trailing circular action cluster — the
    // quiet call button + the tinted directions button per card.
    expect(
      host.querySelectorAll(
        '.location-card a.ui-button[href^="tel:"][data-icon-only]',
      ).length,
    ).toBe(2);
    expect(host.querySelectorAll('.location-card__maps').length).toBe(2);
    // Open/closed lines ride the shared ui-status-indicator pattern.
    expect(
      host.querySelectorAll('.location-card ui-status-indicator').length,
    ).toBe(2);
    // Icons are named by INTENT (semantic registry keys); the registry
    // resolves the directions intent to inline SVG artwork.
    const directions = host.querySelector<HTMLElement>(
      '.location-card__maps ui-icon',
    );
    expect(directions?.getAttribute('data-name')).toBe('location.directions');
    expect(directions?.querySelector('svg.ui-icon__glyph path')).not.toBeNull();
    expect(host.querySelector('[data-locations-map]')).not.toBeNull();
    expect(host.querySelector('.location-card__media')).toBeNull();

    const sheet = host.querySelector<HTMLElement>(
      '#location-detail-sheet.ui-sheet[role="dialog"]',
    );
    expect(sheet).not.toBeNull();
    expect(sheet?.hasAttribute('data-presented')).toBe(false);

    const firstCard = host.querySelector<HTMLElement>('.location-card');
    firstCard?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    fixture.detectChanges();
    await fixture.whenStable();

    expect(sheet?.hasAttribute('data-presented')).toBe(true);
    expect(host.querySelector('[data-location-sheet-map]')).not.toBeNull();
    // Opening hours: the status is the segmented run's LABEL — chrome
    // above the group, neither a container around it nor an eighth day
    // segment. Today = uiSelected.
    const hours = host.querySelector('.location-sheet__hours');
    expect(hours?.tagName).toBe('UI-STACK');
    expect(
      hours?.querySelector(
        ':scope > ui-status-indicator.location-sheet__hours-label',
      ),
    ).not.toBeNull();
    const week = hours?.querySelector('ul.ui-list-group.location-sheet__week');
    expect(week?.querySelectorAll(':scope > li.ui-list-row').length).toBe(7);
    expect(
      host.querySelector('.location-sheet__week li.ui-list-row[data-selected]'),
    ).not.toBeNull();

    // The sheet's ONE action row is the bottom ui-sheet-action-bar —
    // visible for the sheet's whole open lifetime (no scroll-triggered
    // reveal), with no duplicate CTA cluster in the intro. Every bar
    // control shares the large 52px tier (no mixed sizes within one
    // group), and the book CTA carries the full venue context on its
    // aria-label while showing the short register.
    expect(host.querySelector('.location-sheet__hero-actions')).toBeNull();
    const toolbar = host.querySelector<HTMLElement>(
      'ui-sheet-action-bar.location-sheet__toolbar',
    );
    expect(toolbar).not.toBeNull();
    expect(toolbar?.hasAttribute('data-visible')).toBe(true);
    const toolbarActions = toolbar?.querySelectorAll<HTMLElement>('.ui-button');
    expect(toolbarActions?.length).toBe(3);
    toolbarActions?.forEach((button) => {
      expect(button.getAttribute('data-control-size')).toBe('large');
      expect(button.getAttribute('tabindex')).toBeNull();
    });
    expect(
      toolbar
        ?.querySelector('.location-sheet__toolbar-book')
        ?.getAttribute('aria-label'),
    ).toBeTruthy();

    // No card surface and no hairline around the hours: the stack gap
    // separates the label from the run, and between days the seam IS the
    // separator. "Today" is conveyed to AT via SR-only text instead of a
    // redundant visual tag on the already-emphasized row.
    expect(hours?.querySelector('ui-card')).toBeNull();
    expect(hours?.querySelector('ui-divider')).toBeNull();
    expect(host.querySelector('.location-sheet__today-tag')).toBeNull();
    expect(
      host.querySelector(
        '.location-sheet__week li.ui-list-row[data-selected] [data-visually-hidden]',
      ),
    ).not.toBeNull();
  });

  it('fails soft when MapLibre cannot be fetched — logs, keeps the list, rejects nothing', async () => {
    const logged = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    onTestFinished(() => logged.mockRestore());
    // What a stale deploy or a dropped connection gives a lazy chunk.
    const offline = new TypeError(
      'Failed to fetch dynamically imported module',
    );
    const sources: MapLibreSources = {
      library: () => Promise.reject(offline),
      stylesheet: async () => '',
    };
    await TestBed.configureTestingModule({
      imports: [LocationsComponent],
      providers: [
        ...provideTestI18n(),
        ...provideTestCatalog(),
        { provide: CLOCK_PORTS, useValue: memoryClockPorts() },
        { provide: MAPLIBRE_SOURCES, useValue: sources },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(LocationsComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    // Before the fix the load was awaited outside every try: the rejection
    // escaped `ngAfterViewInit` unhandled and nothing was logged.
    await vi.waitFor(() =>
      expect(logged).toHaveBeenCalledWith(
        '[cr-locations] map failed to load:',
        offline,
      ),
    );
    const host: HTMLElement = fixture.nativeElement;
    expect(host.querySelectorAll('.location-card').length).toBe(2);
    expect(
      host.querySelector('[data-locations-map]')?.childElementCount ?? 0,
    ).toBe(0);
  });

  /**
   * The open/closed line and the sheet's bold «today» row run on the SHOP's
   * clock — each location's zone (Europe/Sofia, from the static landing
   * content), read through the injected clock — never the visitor's device.
   * Pinned at four Sofia instants (EEST, UTC+3), one per status line.
   */
  describe('on the shop clock', () => {
    async function renderAt(now: UtcEpochMs) {
      await TestBed.configureTestingModule({
        imports: [LocationsComponent],
        providers: [
          ...provideTestI18n(),
          ...provideTestCatalog(),
          { provide: CLOCK_PORTS, useValue: memoryClockPorts(now) },
        ],
      }).compileComponents();
      const fixture = TestBed.createComponent(LocationsComponent);
      fixture.detectChanges();
      await fixture.whenStable();
      return fixture;
    }

    /** Each card's status line (tone + text), centre first. */
    function cardLines(host: HTMLElement): readonly string[] {
      return Array.from(
        host.querySelectorAll<HTMLElement>(
          '.location-card ui-status-indicator',
        ),
        (line) =>
          `${line.getAttribute('data-tone')} · ${(line.textContent ?? '')
            .replace(/\s+/g, ' ')
            .trim()}`,
      );
    }

    /** Opens the centre's sheet and reads its bold (selected) week rows. */
    async function boldRows(
      fixture: Awaited<ReturnType<typeof renderAt>>,
    ): Promise<readonly string[]> {
      const host: HTMLElement = fixture.nativeElement;
      host
        .querySelector<HTMLElement>('.location-card')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      fixture.detectChanges();
      await fixture.whenStable();
      return Array.from(
        host.querySelectorAll<HTMLElement>(
          '.location-sheet__week li.ui-list-row[data-selected]',
        ),
        (row) => (row.textContent ?? '').replace(/\s+/g, ' ').trim(),
      );
    }

    it('names Monday for the centre and Tuesday for Mladost on a Sunday, with Sunday bold', async () => {
      // Sunday 2026-09-20, 12:00 in Sofia.
      const fixture = await renderAt(utcMs('2026-09-20T09:00:00Z'));

      expect(cardLines(fixture.nativeElement)).toEqual([
        'destructive · Затворено Отваря в Понеделник в 09:00',
        'destructive · Затворено Отваря в Вторник в 10:00',
      ]);
      expect(await boldRows(fixture)).toEqual(['Неделя Днес Почивен']);
    });

    it('warns that the centre closes soon at 19:10 on a weekday, with that day bold', async () => {
      // Thursday 2026-09-17, 19:10 in Sofia — 50 minutes before 20:00.
      const fixture = await renderAt(utcMs('2026-09-17T16:10:00Z'));

      expect(cardLines(fixture.nativeElement)).toEqual([
        'warning · Отворено Скоро затваря · 20:00',
        'destructive · Затворено Отваря в Петък в 10:00',
      ]);
      expect(await boldRows(fixture)).toEqual(['Четвъртък Днес 09:00 – 20:00']);
    });

    it('says when today opens at 08:30, before either shop opens', async () => {
      // Thursday 2026-09-17, 08:30 in Sofia.
      const fixture = await renderAt(utcMs('2026-09-17T05:30:00Z'));

      expect(cardLines(fixture.nativeElement)).toEqual([
        'destructive · Затворено Отваря в 09:00',
        'destructive · Затворено Отваря в 10:00',
      ]);
      expect(await boldRows(fixture)).toEqual(['Четвъртък Днес 09:00 – 20:00']);
    });

    it('names the next day at 20:30, after closing', async () => {
      // Thursday 2026-09-17, 20:30 in Sofia.
      const fixture = await renderAt(utcMs('2026-09-17T17:30:00Z'));

      expect(cardLines(fixture.nativeElement)).toEqual([
        'destructive · Затворено Отваря в Петък в 09:00',
        'destructive · Затворено Отваря в Петък в 10:00',
      ]);
      expect(await boldRows(fixture)).toEqual(['Четвъртък Днес 09:00 – 20:00']);
    });

    it('keeps the open line while open — «Closes at 20:00» at noon', async () => {
      // Thursday 2026-09-17, 12:00 in Sofia.
      const fixture = await renderAt(utcMs('2026-09-17T09:00:00Z'));

      expect(cardLines(fixture.nativeElement)).toEqual([
        'success · Отворено Затваря в 20:00',
        'success · Отворено Затваря в 19:00',
      ]);
    });
  });
});
