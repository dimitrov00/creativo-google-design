import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { UiLineChart } from '@creativo/ui/charts';
import { afterEach, describe, expect, it } from 'vitest';
import {
  byTestId,
  renderAnalyticsScreen,
  settle,
} from '../../testing/analytics-screen.spec-support';
import { AnalyticsCardPage } from './analytics-card.page';

const render = (
  card: string,
  options: Omit<Parameters<typeof renderAnalyticsScreen>[1], 'card'> = {},
) =>
  renderAnalyticsScreen(AnalyticsCardPage, {
    card,
    query: { span: 'MONTH', from: '2026-09-01' },
    ...options,
  });

afterEach(() => {
  TestBed.resetTestingModule();
});

describe('AnalyticsCardPage — a card’s own screen (staff-analytics-v3)', () => {
  it('«Оборот»: the figure, the line by default, and the switch to bars and the ring with the figure in its centre', async () => {
    const { fixture, host } = await render('takings');
    expect(byTestId(host, 'analytics-card-title')?.textContent?.trim()).toBe(
      'Оборот',
    );
    expect(byTestId(host, 'analytics-card-value')?.textContent).toContain(
      '45,50',
    );
    expect(byTestId(host, 'analytics-card-subline')?.textContent).toContain(
      'Този месец',
    );
    const chart = () =>
      byTestId(host, 'analytics-card-chart')?.querySelector('[data-view]');
    expect(chart()?.tagName.toLowerCase()).toBe('ui-line-chart');
    expect(chart()?.getAttribute('data-view')).toBe('LINE');

    byTestId(host, 'analytics-view-BARS')?.click();
    await settle(fixture);
    expect(chart()?.tagName.toLowerCase()).toBe('ui-bar-chart');

    byTestId(host, 'analytics-view-RING')?.click();
    await settle(fixture);
    expect(chart()?.tagName.toLowerCase()).toBe('ui-ring-chart');
    expect(chart()?.querySelector('[uiRingCenter]')?.textContent).toContain(
      '45,50',
    );
    // The figure broken down: the services, ranked.
    expect(byTestId(host, 'analytics-services-bars')).not.toBeNull();
  });

  it('a finger on the line reads that day in the header, the change hidden, and lets go back to the period', async () => {
    const { fixture, host } = await render('takings');
    const line = fixture.debugElement.query(By.directive(UiLineChart))
      .componentInstance as UiLineChart;
    const value = () =>
      byTestId(host, 'analytics-card-value')?.textContent?.trim();
    const subline = () => byTestId(host, 'analytics-card-subline');

    line.uiScrubbed.emit(0);
    await settle(fixture);
    expect(subline()?.textContent).toContain('1 септември · предходен');
    expect(subline()?.hasAttribute('data-scrubbing')).toBe(true);
    expect(subline()?.getAttribute('aria-live')).toBe('off');
    expect(host.querySelector('.analytics-card__delta')).toBeNull();

    line.uiScrubbed.emit(null);
    await settle(fixture);
    expect(value()).toContain('45,50');
    expect(subline()?.textContent).toContain('Този месец');
    expect(subline()?.getAttribute('aria-live')).toBe('polite');
    expect(host.querySelector('.analytics-card__delta')).not.toBeNull();
  });

  it('the range row: 1М on the month, and 6М asks for six calendar months up to today', async () => {
    const { fixture, host, sent } = await render('takings');
    const on = byTestId(host, 'analytics-ranges')?.querySelector(
      '[aria-checked="true"]',
    );
    expect(on?.textContent?.trim()).toBe('1М');
    byTestId(host, 'analytics-range-SIX_MONTHS')?.click();
    await settle(fixture);
    await settle(fixture);
    expect(sent.at(-1)).toMatchObject({
      analyticsSpan: 'CUSTOM',
      fromLocalDate: '2026-04-01',
      toLocalDate: '2026-09-28',
    });
  });

  it('«…» opens the custom period sheet on «От», its calendar unfolded, «До» folded', async () => {
    const { fixture, host } = await render('takings');
    byTestId(host, 'analytics-custom-range')?.click();
    await settle(fixture);
    expect(
      byTestId(host, 'analytics-range-from')?.getAttribute('aria-expanded'),
    ).toBe('true');
    expect(byTestId(host, 'analytics-range-from-calendar')).not.toBeNull();
    expect(byTestId(host, 'analytics-range-to-calendar')).toBeNull();
    byTestId(host, 'analytics-range-to')?.click();
    await settle(fixture);
    expect(byTestId(host, 'analytics-range-from-calendar')).toBeNull();
    expect(byTestId(host, 'analytics-range-to-calendar')).not.toBeNull();
  });

  it('«Работно време»: the stacked bars by default, the parts with their minutes, the days, when the chair is busy', async () => {
    const { host } = await render('time');
    expect(
      byTestId(host, 'analytics-card-chart')
        ?.querySelector('[data-view]')
        ?.getAttribute('data-view'),
    ).toBe('BARS');
    expect(
      byTestId(host, 'analytics-time-bar')?.querySelectorAll('li'),
    ).toHaveLength(6);
    expect(byTestId(host, 'analytics-time-days')).not.toBeNull();
    expect(byTestId(host, 'analytics-heatmap')).not.toBeNull();
  });

  it('«Презаписали» has the ring alone for a barber — no switch — and the clients’ tiles', async () => {
    const { host } = await render('rebooked');
    expect(byTestId(host, 'analytics-views')).toBeNull();
    expect(
      byTestId(host, 'analytics-card-chart')
        ?.querySelector('[data-view]')
        ?.getAttribute('data-view'),
    ).toBe('RING');
    expect(byTestId(host, 'analytics-clients')).not.toBeNull();
  });

  it('«Екипът» on the shop: bars by barber, a row per barber opening their figures, and the radars', async () => {
    const { host } = await render('team', { admin: true, shop: true });
    expect(
      byTestId(host, 'analytics-card-chart')
        ?.querySelector('[data-view]')
        ?.getAttribute('data-view'),
    ).toBe('BARS');
    expect(byTestId(host, 'analytics-team-ivan')?.getAttribute('href')).toBe(
      '/staff/analytics?barber=ivan',
    );
    expect(
      byTestId(host, 'analytics-radars')?.querySelectorAll('ui-radar'),
    ).toHaveLength(2);
  });

  it('its ⓘ says what the figure counts', async () => {
    const { fixture, host } = await render('takings');
    byTestId(host, 'analytics-card-info')?.click();
    await settle(fixture);
    expect(document.body.textContent).toContain('отработените услуги');
  });

  it('an unknown card reads as «Оборот»', async () => {
    const { host } = await render('nonsense');
    expect(byTestId(host, 'analytics-card-title')?.textContent?.trim()).toBe(
      'Оборот',
    );
  });
});
