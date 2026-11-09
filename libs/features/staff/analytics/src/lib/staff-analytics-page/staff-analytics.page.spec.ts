import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BarberId, LocationId } from '@core/primitives';
import { barberFixture, locationFixture } from '@core/testing';
import { shareOrDownloadFile } from '@creativo/infrastructure/web-storage';
import {
  byTestId,
  renderAnalyticsScreen,
  settle,
} from '../../testing/analytics-screen.spec-support';
import { AnalyticsCarousel } from './analytics-carousel';
import { StaffAnalyticsPage } from './staff-analytics.page';

// The app's file hand-off is a browser act: the spec records what the page
// hands it instead of opening a share sheet or clicking a link.
vi.mock('@creativo/infrastructure/web-storage', async (original) => ({
  ...(await original<typeof import('@creativo/infrastructure/web-storage')>()),
  shareOrDownloadFile: vi.fn(async () => 'DOWNLOADED'),
}));

/** A blob's text — jsdom's `Blob` has no `text()`; `FileReader` it has. */
function blobText(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });
}

const render = (options: Parameters<typeof renderAnalyticsScreen>[1] = {}) =>
  renderAnalyticsScreen(StaffAnalyticsPage, options);

afterEach(() => {
  TestBed.resetTestingModule();
});

describe('StaffAnalyticsPage — the Revolut home (staff-analytics-v3)', () => {
  it('draws the title, the period menu on this month, and the current page’s bento of five cards', async () => {
    const { host } = await render();
    expect(byTestId(host, 'analytics-title')?.textContent?.trim()).toBe(
      'Анализи',
    );
    expect(byTestId(host, 'analytics-period')?.textContent?.trim()).toBe(
      'Този месец',
    );
    // A barber has nothing to choose: no scope menu.
    expect(byTestId(host, 'analytics-scope-menu')).toBeNull();
    const current = host.querySelector(
      '.analytics-carousel__page[data-current]',
    );
    expect(current?.getAttribute('data-testid')).toBe(
      'analytics-page-MONTH-2026-09-01',
    );
    const cards = Array.from(
      current?.querySelectorAll<HTMLElement>(
        '[data-testid^="analytics-card-"]',
      ) ?? [],
    ).map((card) => card.getAttribute('data-testid'));
    expect(cards).toEqual([
      'analytics-card-takings',
      'analytics-card-time',
      'analytics-card-free',
      'analytics-card-tips',
      'analytics-card-clients',
    ]);
    const takings = byTestId(host, 'analytics-card-takings');
    expect(takings?.textContent).toContain('45,50');
    // The pace line and its legend: this month against last by the same day.
    expect(takings?.querySelector('ui-spark-line')).not.toBeNull();
    expect(takings?.textContent).toContain('Миналия месец');
    // Each card opens its own screen on this page's period.
    expect(takings?.getAttribute('href')).toBe(
      '/staff/analytics/takings?span=MONTH&from=2026-09-01',
    );
  });

  it('holds a page per month of the reach, the current one last, and only its neighbours draw', async () => {
    const { host } = await render();
    const pages = host.querySelectorAll('.analytics-carousel__page');
    expect(pages).toHaveLength(13);
    expect(pages[12]?.hasAttribute('data-current')).toBe(true);
    expect(pages[12]?.hasAttribute('inert')).toBe(false);
    expect(pages[11]?.hasAttribute('inert')).toBe(true);
    // The neighbour has no cached report: its bones; a far page nothing.
    expect(pages[11]?.querySelector('lib-analytics-bento')).not.toBeNull();
    expect(pages[0]?.querySelector('lib-analytics-bento')).toBeNull();
  });

  it('a swipe that settles on the page before asks for that period, relabels the button and replaces the URL', async () => {
    const { fixture, host, sent, router } = await render();
    const carousel = fixture.debugElement.query(By.directive(AnalyticsCarousel))
      .componentInstance as AnalyticsCarousel;
    carousel.settled.emit(11);
    await settle(fixture);
    await settle(fixture);
    expect(sent.at(-1)?.fromLocalDate).toBe('2026-08-01');
    expect(byTestId(host, 'analytics-period')?.textContent?.trim()).toBe(
      'Миналия месец',
    );
    expect(router.url).toBe('/?span=MONTH&from=2026-08-01');
  });

  it('the period menu offers the grain and opens it on the current period', async () => {
    const { fixture, host, sent } = await render({
      query: { span: 'MONTH', from: '2026-08-01' },
    });
    byTestId(host, 'analytics-period-menu')?.click();
    await settle(fixture);
    const grains = Array.from(
      document.querySelectorAll<HTMLElement>(
        '[data-testid^="analytics-grain-"]',
      ),
    );
    expect(grains.map((g) => g.textContent?.trim())).toEqual([
      'Дневно',
      'Седмично',
      'Месечно',
      'Годишно',
    ]);
    grains[1]?.click();
    await settle(fixture);
    await settle(fixture);
    expect(sent.at(-1)).toMatchObject({
      analyticsSpan: 'WEEK',
      fromLocalDate: '2026-09-28',
    });
    expect(byTestId(host, 'analytics-period')?.textContent?.trim()).toBe(
      'Тази седмица',
    );
  });

  it('the admin chooses whose figures in the scope menu, and the shop’s page carries the team', async () => {
    const { fixture, host, sent } = await render({
      admin: true,
      shop: true,
      barbers: [
        barberFixture({ id: BarberId.of('ivan') }),
        barberFixture({ id: BarberId.of('niko') }),
      ],
    });
    const trigger = byTestId(host, 'analytics-scope-menu');
    expect(trigger?.textContent).toContain('Салон');
    expect(byTestId(host, 'analytics-card-team')?.textContent).toContain(
      '28,00',
    );
    trigger?.click();
    await settle(fixture);
    // The team's row, picked whole; its chevron opens a box per barber.
    expect(
      document.querySelector('[data-testid="analytics-scope-team"]'),
    ).not.toBeNull();
    document
      .querySelector<HTMLElement>('[data-testid="analytics-scope-team-open"]')
      ?.click();
    await settle(fixture);
    const boxes = Array.from(
      document.querySelectorAll<HTMLElement>('[role="menuitemcheckbox"]'),
    );
    expect(boxes.length).toBeGreaterThan(1);
    expect(
      boxes.every((box) => box.getAttribute('aria-checked') === 'true'),
    ).toBe(true);
    // Unticking Niko leaves Ivan's own report; the menu stays up.
    document
      .querySelector<HTMLElement>('[data-testid="analytics-scope-niko"]')
      ?.click();
    await settle(fixture);
    await settle(fixture);
    expect(
      document
        .querySelector('[data-testid="analytics-scope-niko"]')
        ?.getAttribute('aria-checked'),
    ).toBe('false');
    expect(sent.at(-1)?.scopeBarberIds).toEqual(['ivan']);
    expect(byTestId(host, 'analytics-card-team')).toBeNull();
  });

  it('with two locations the admin ticks shops in the submenu: the call, the URL and the pill follow (ADR 2026-11-09)', async () => {
    const { fixture, host, sent, router } = await render({
      admin: true,
      shop: true,
      locations: [
        locationFixture(),
        locationFixture({ id: LocationId.of('loc-mladost') }),
      ],
    });
    const trigger = byTestId(host, 'analytics-scope-menu');
    expect(trigger?.textContent).toContain('Всички салони');
    trigger?.click();
    await settle(fixture);
    document
      .querySelector<HTMLElement>(
        '[data-testid="analytics-scope-locations-open"]',
      )
      ?.click();
    await settle(fixture);
    // Every shop ticked while none is named; unticking the centre leaves Mladost.
    document
      .querySelector<HTMLElement>(
        `[data-testid="analytics-scope-location-${locationFixture().id}"]`,
      )
      ?.click();
    await settle(fixture);
    await settle(fixture);
    expect(sent.at(-1)?.scopeLocationIds).toEqual(['loc-mladost']);
    expect(sent.at(-1)?.scopeBarberIds).toEqual([]);
    expect(router.url).toContain('location=loc-mladost');
    // The menu stays up on the shops' boxes: the centre's off, Mladost's on.
    expect(
      document
        .querySelector(
          `[data-testid="analytics-scope-location-${locationFixture().id}"]`,
        )
        ?.getAttribute('aria-checked'),
    ).toBe('false');
    expect(
      document
        .querySelector('[data-testid="analytics-scope-location-loc-mladost"]')
        ?.getAttribute('aria-checked'),
    ).toBe('true');
  });

  it('under the carousel: the days ahead open the schedule on the emptiest day, the tools set a goal and export', async () => {
    const { host } = await render();
    const ahead = byTestId(host, 'analytics-ahead');
    expect(ahead?.getAttribute('href')).toContain('/staff/schedule?');
    expect(ahead?.getAttribute('href')).toContain('free=1');
    expect(byTestId(host, 'analytics-tool-goal')?.textContent).toContain(
      'Задай цел',
    );
    expect(byTestId(host, 'analytics-tool-export')?.textContent).toContain(
      'Експорт',
    );
  });

  it('«Експорт» hands the figures on screen to the file hand-off as the CSV, from the tap', async () => {
    vi.mocked(shareOrDownloadFile).mockClear();
    const { fixture, host } = await render();
    byTestId(host, 'analytics-tool-export')?.click();
    await settle(fixture);
    const handed = vi.mocked(shareOrDownloadFile).mock.calls;
    expect(handed).toHaveLength(1);
    const [name, blob] = handed[0] as [string, Blob];
    expect(name).toBe('creativo-analytics-2026-09-01-2026-09-30.csv');
    const text = await blobText(blob);
    expect(text.split('\r\n')[0]).toBe(
      'вид;бръснар;дата;работено мин;неявяване мин;немаркирано мин;блокирано мин;почивка мин;непродадено мин;друго мин;оборот;бакшиш',
    );
  });

  it('«Задай цел» saves the sheet’s range, and the goal card draws its ring from the next report', async () => {
    const { fixture, host, goals } = await render();
    byTestId(host, 'analytics-tool-goal')?.click();
    await settle(fixture);
    const type = (id: string, raw: string) => {
      const input = byTestId(host, id) as HTMLInputElement;
      input.value = raw;
      input.dispatchEvent(new Event('input'));
      input.dispatchEvent(new Event('change'));
    };
    type('analytics-goal-low', '1800');
    type('analytics-goal-high', '2200');
    await settle(fixture);
    byTestId(host, 'analytics-goal-save')?.click();
    await settle(fixture);
    await settle(fixture);
    expect(goals).toEqual([
      {
        scopeBarberId: null,
        goalMonth: '2026-09',
        goalLowCents: 180_000,
        goalHighCents: 220_000,
      },
    ]);
    expect(byTestId(host, 'analytics-goal-pace')?.textContent?.trim()).toBe(
      '12 от 22 работни дни · на път',
    );
    expect(byTestId(host, 'analytics-tool-goal')?.textContent).toContain(
      'Промени целта',
    );
    // «Премахни целта» — offered once a goal is set — sends no range, and
    // the card goes back to offering one.
    byTestId(host, 'analytics-tool-goal')?.click();
    await settle(fixture);
    byTestId(host, 'analytics-goal-remove')?.click();
    await settle(fixture);
    await settle(fixture);
    expect(goals.at(-1)).toEqual({
      scopeBarberId: null,
      goalMonth: '2026-09',
      goalLowCents: null,
      goalHighCents: null,
    });
    expect(byTestId(host, 'analytics-goal-pace')).toBeNull();
    expect(byTestId(host, 'analytics-tool-goal')?.textContent).toContain(
      'Задай цел',
    );
  });

  it('a refused account sees the refusal, no carousel and no tools', async () => {
    const { host } = await render({ refuse: true });
    expect(byTestId(host, 'analytics-refused')).not.toBeNull();
    expect(byTestId(host, 'analytics-carousel')).toBeNull();
    expect(byTestId(host, 'analytics-tools')).toBeNull();
  });
});

describe('StaffAnalyticsPage — the URL as inputs (route-inputs.ts)', () => {
  it('?span=WEEK&from=<day> binds: the week that holds the day, asked for once, written back as its first day', async () => {
    const { host, sent, router } = await render({
      query: { span: 'WEEK', from: '2026-09-30' },
    });
    expect(byTestId(host, 'analytics-period')?.textContent?.trim()).toBe(
      'Тази седмица',
    );
    expect(sent).toEqual([
      {
        scopeBarberIds: [],
        scopeLocationIds: [],
        fromLocalDate: '2026-09-28',
        analyticsSpan: 'WEEK',
        toLocalDate: null,
        analyticsComparison: 'PREVIOUS',
      },
    ]);
    expect(router.url).toBe('/?span=WEEK&from=2026-09-28');
  });

  it('a silent URL is this month, written back once the request stands', async () => {
    const { sent, router } = await render();
    expect(sent).toHaveLength(1);
    expect(router.url).toBe('/?span=MONTH&from=2026-09-01');
  });

  it('a barber’s ?barber= is ignored; an unknown span is a month', async () => {
    const { sent, router } = await render({
      query: { span: 'QUARTER', barber: 'niko', to: '2026-09-30' },
    });
    expect(sent).toEqual([
      {
        scopeBarberIds: [],
        scopeLocationIds: [],
        fromLocalDate: '2026-09-01',
        analyticsSpan: 'MONTH',
        toLocalDate: null,
        analyticsComparison: 'PREVIOUS',
      },
    ]);
    expect(router.url).toBe('/?span=MONTH&from=2026-09-01');
  });

  it('an admin’s ?barber= is the scope, and a swipe replaces the URL without a second request for the echo', async () => {
    const { fixture, sent, router } = await render({
      query: { span: 'WEEK', from: '2026-09-30', barber: 'ivan' },
      admin: true,
    });
    expect(sent).toEqual([
      {
        scopeBarberIds: ['ivan'],
        scopeLocationIds: [],
        fromLocalDate: '2026-09-28',
        analyticsSpan: 'WEEK',
        toLocalDate: null,
        analyticsComparison: 'PREVIOUS',
      },
    ]);
    expect(router.url).toBe('/?span=WEEK&from=2026-09-28&barber=ivan');
    const carousel = fixture.debugElement.query(By.directive(AnalyticsCarousel))
      .componentInstance as AnalyticsCarousel;
    const pages = fixture.nativeElement.querySelectorAll(
      '.analytics-carousel__page',
    ).length;
    carousel.settled.emit(pages - 2);
    await settle(fixture);
    await settle(fixture);
    expect(router.url).toBe('/?span=WEEK&from=2026-09-21&barber=ivan');
    expect(sent).toHaveLength(2);
    expect(sent[1]?.fromLocalDate).toBe('2026-09-21');
  });
});
