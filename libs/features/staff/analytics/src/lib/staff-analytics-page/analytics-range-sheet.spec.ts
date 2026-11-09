import { Component, signal } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { localDate } from '@core/testing';
import type { UiDateFieldParts } from '@creativo/ui/controls';
import type { AnalyticsRangeVm } from '../analytics.vm';
import { AnalyticsRangeSheet } from './analytics-range-sheet';

const WORDS: AnalyticsRangeVm = {
  pillLabel: 'Друг период',
  title: 'Друг период',
  fromLabel: 'От',
  toLabel: 'До',
  dayLabel: 'Ден',
  monthLabel: 'Месец',
  yearLabel: 'Година',
  dayPlaceholder: 'ДД',
  monthPlaceholder: 'ММ',
  yearPlaceholder: 'ГГГГ',
  applyLabel: 'Приложи',
  closeLabel: 'Затвори',
  refusal: 'Въведете двете дати',
  applyEnabled: false,
  chooseLabel: 'Избери',
  previousMonthLabel: 'Предишен месец',
  nextMonthLabel: 'Следващ месец',
  locale: 'bg',
  today: localDate('2026-09-28'),
  earliest: localDate('2025-09-01'),
};

@Component({
  imports: [AnalyticsRangeSheet],
  template: `
    <lib-analytics-range-sheet
      [vm]="vm()"
      [open]="open()"
      [from]="from()"
      [to]="to()"
      [fromText]="fromText()"
      [toText]="null"
      (fromChange)="from.set($event)"
      (toChange)="to.set($event)"
      (applied)="applied = applied + 1"
      (closed)="closed = closed + 1"
    />
  `,
})
class Host {
  readonly vm = signal<AnalyticsRangeVm>(WORDS);
  readonly open = signal(true);
  readonly from = signal<UiDateFieldParts | null>(null);
  readonly to = signal<UiDateFieldParts | null>(null);
  readonly fromText = signal<string | null>(null);
  applied = 0;
  closed = 0;
}

async function render(): Promise<{
  fixture: ComponentFixture<Host>;
  host: Host;
  root: HTMLElement;
}> {
  TestBed.configureTestingModule({ imports: [Host] });
  const fixture = TestBed.createComponent(Host);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return {
    fixture,
    host: fixture.componentInstance,
    root: fixture.nativeElement as HTMLElement,
  };
}

const byTestId = (root: HTMLElement, id: string) =>
  root.querySelector<HTMLElement>(`[data-testid="${id}"]`);

afterEach(() => TestBed.resetTestingModule());

describe('AnalyticsRangeSheet — two collapsible rows with inline calendars and «Приложи»', () => {
  it('opens on «От», its calendar unfolded; each row says its date or «Избери»; «Приложи» stays off while the store refuses', async () => {
    const { fixture, host, root } = await render();
    expect(
      byTestId(root, 'analytics-range-from')?.getAttribute('aria-expanded'),
    ).toBe('true');
    expect(byTestId(root, 'analytics-range-from-calendar')).not.toBeNull();
    expect(byTestId(root, 'analytics-range-to-calendar')).toBeNull();
    expect(
      byTestId(root, 'analytics-range-from-value')?.textContent?.trim(),
    ).toBe('Избери');
    host.fromText.set('1.09');
    fixture.detectChanges();
    expect(
      byTestId(root, 'analytics-range-from-value')?.textContent?.trim(),
    ).toBe('1.09');
    const apply = byTestId(root, 'analytics-range-apply') as HTMLButtonElement;
    expect(apply.disabled).toBe(true);
    expect(byTestId(root, 'analytics-range-refusal')?.textContent?.trim()).toBe(
      'Въведете двете дати',
    );
  });

  it('a tap on a row unfolds its calendar and folds the other; a second tap folds it', async () => {
    const { fixture, root } = await render();
    byTestId(root, 'analytics-range-to')?.click();
    fixture.detectChanges();
    expect(byTestId(root, 'analytics-range-from-calendar')).toBeNull();
    expect(byTestId(root, 'analytics-range-to-calendar')).not.toBeNull();
    byTestId(root, 'analytics-range-to')?.click();
    fixture.detectChanges();
    expect(byTestId(root, 'analytics-range-to-calendar')).toBeNull();
  });

  it('a day picked for «От» is handed up and moves on to «До»; a day for «До» folds it', async () => {
    const { fixture, host, root } = await render();
    // The store opens the sheet on the period on screen (`openRange`).
    host.from.set({ year: 2026, month: 9, day: 1 });
    host.to.set({ year: 2026, month: 9, day: 28 });
    fixture.detectChanges();
    const day = (calendar: string, date: string) =>
      byTestId(root, calendar)?.querySelector<HTMLButtonElement>(
        `[data-testid="ui-month-day-${date}"]`,
      );
    day('analytics-range-from-calendar', '2026-09-03')?.click();
    fixture.detectChanges();
    expect(host.from()).toEqual({ year: 2026, month: 9, day: 3 });
    expect(byTestId(root, 'analytics-range-to-calendar')).not.toBeNull();
    day('analytics-range-to-calendar', '2026-09-20')?.click();
    fixture.detectChanges();
    expect(host.to()).toEqual({ year: 2026, month: 9, day: 20 });
    expect(byTestId(root, 'analytics-range-to-calendar')).toBeNull();
  });

  it('applies once the store admits the range, then starts its own exit', async () => {
    const { fixture, host, root } = await render();
    host.vm.set({ ...WORDS, refusal: null, applyEnabled: true });
    fixture.detectChanges();
    const apply = byTestId(root, 'analytics-range-apply') as HTMLButtonElement;
    expect(apply.disabled).toBe(false);
    apply.click();
    fixture.detectChanges();
    expect(host.applied).toBe(1);
    expect(host.closed).toBe(0);
  });
});
