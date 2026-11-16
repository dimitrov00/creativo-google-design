import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { LocalDate } from '@core/primitives';
import { localDate } from '@core/testing';
import { UiDateRow } from './date-row';

@Component({
  imports: [UiDateRow],
  template: `
    <ui-date-row
      uiLabel="Последен работен ден"
      uiTestId="last"
      uiLocale="bg"
      uiPlaceholder="Няма"
      [uiSelected]="selected()"
      [uiToday]="today"
      [uiMin]="min()"
      [uiMarked]="marked()"
      [uiDisabled]="disabled()"
      (uiPicked)="onPicked($event)"
    />
  `,
})
class Host {
  readonly selected = signal<LocalDate | null>(null);
  readonly min = signal<LocalDate | null>(localDate('2026-11-10'));
  readonly marked = signal<readonly LocalDate[]>([localDate('2026-11-18')]);
  readonly disabled = signal(false);
  readonly today = localDate('2026-11-15');
  picked: LocalDate[] = [];

  onPicked(day: LocalDate): void {
    this.picked.push(day);
    this.selected.set(day);
  }
}

async function render() {
  await TestBed.configureTestingModule({ imports: [Host] }).compileComponents();
  const fixture = TestBed.createComponent(Host);
  fixture.detectChanges();
  const host = fixture.nativeElement as HTMLElement;
  const pill = () =>
    host.querySelector<HTMLButtonElement>('[data-testid="last"]');
  const calendar = () =>
    host.querySelector<HTMLElement>('[data-testid="last-calendar"]');
  const day = (key: string) =>
    host.querySelector<HTMLButtonElement>(
      `[data-testid="ui-month-day-${key}"]`,
    );
  return { fixture, host, pill, calendar, day };
}

describe('UiDateRow', () => {
  it('is a form row: the label, and the day in a capsule at the trailing edge — the placeholder while it holds none', async () => {
    const { fixture, host, pill } = await render();
    const value = () =>
      host.querySelector<HTMLElement>('[data-testid="last-value"]');

    expect(host.querySelector('.ui-list-row')?.textContent).toContain(
      'Последен работен ден',
    );
    expect(pill()?.closest('[uitrailing]')).not.toBeNull();
    expect(value()?.textContent?.trim()).toBe('Няма');
    expect(pill()?.getAttribute('aria-label')).toBe(
      'Последен работен ден: Няма',
    );

    fixture.componentInstance.selected.set(localDate('2026-11-20'));
    fixture.detectChanges();

    // The day as the app names a day in a pill: weekday first.
    expect(value()?.textContent?.trim()).toBe('пт, 20.11');
  });

  it('pops the month on a press, opening an empty row on its floor’s month with the marked days dotted and the days before the floor refused', async () => {
    const { fixture, pill, calendar, day } = await render();
    expect(calendar()).toBeNull();

    pill()?.click();
    fixture.detectChanges();

    expect(calendar()).not.toBeNull();
    expect(day('2026-11-18')?.hasAttribute('data-marked')).toBe(true);
    expect(day('2026-11-17')?.hasAttribute('data-marked')).toBe(false);
    expect(day('2026-11-09')?.disabled).toBe(true);
    expect(day('2026-11-10')?.disabled).toBe(false);
  });

  it('hands the picked day up and closes the month', async () => {
    const { fixture, pill, calendar, day } = await render();
    pill()?.click();
    fixture.detectChanges();

    day('2026-11-20')?.click();
    fixture.detectChanges();

    expect(fixture.componentInstance.picked).toEqual([localDate('2026-11-20')]);
    expect(calendar()).toBeNull();
  });

  it('answers nothing while disabled', async () => {
    const { fixture, pill, calendar } = await render();
    fixture.componentInstance.disabled.set(true);
    fixture.detectChanges();

    expect(pill()?.disabled).toBe(true);
    pill()?.click();
    fixture.detectChanges();

    expect(calendar()).toBeNull();
  });
});
