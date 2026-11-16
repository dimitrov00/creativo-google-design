import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { LocalDate } from '@core/primitives';
import { localDate } from '@core/testing';
import { UiDateRow } from './date-row';

@Component({
  imports: [UiDateRow],
  template: `
    <ui-date-row
      uiLabel="Последен ден"
      uiTestId="last"
      uiLocale="bg"
      uiPlaceholder="Няма"
      uiClearLabel="Без последен ден"
      uiMarkedLabel="Дни със записи"
      [uiSelected]="selected()"
      [uiToday]="today"
      [uiMin]="min()"
      [uiMarked]="marked()"
      [uiDisabled]="disabled()"
      (uiPicked)="onPicked($event)"
      (uiCleared)="onCleared()"
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
  cleared = 0;

  onPicked(day: LocalDate): void {
    this.picked.push(day);
    this.selected.set(day);
  }

  onCleared(): void {
    this.cleared += 1;
    this.selected.set(null);
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
  const piece = (id: string) =>
    host.querySelector<HTMLElement>(`[data-testid="${id}"]`);
  return { fixture, host, pill, calendar, day, piece };
}

describe('UiDateRow', () => {
  it('is a form row: the label, and the day in a capsule at the trailing edge — the placeholder while it holds none', async () => {
    const { fixture, host, pill } = await render();
    const value = () =>
      host.querySelector<HTMLElement>('[data-testid="last-value"]');

    expect(host.querySelector('.ui-list-row')?.textContent).toContain(
      'Последен ден',
    );
    expect(pill()?.closest('[uitrailing]')).not.toBeNull();
    expect(value()?.textContent?.trim()).toBe('Няма');
    expect(pill()?.getAttribute('aria-label')).toBe('Последен ден: Няма');

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

  it('says what the dots mean under the month — only while some day is marked', async () => {
    const { fixture, pill, piece } = await render();
    pill()?.click();
    fixture.detectChanges();
    expect(piece('last-legend')?.textContent?.trim()).toBe('Дни със записи');

    fixture.componentInstance.marked.set([]);
    fixture.detectChanges();
    expect(piece('last-legend')).toBeNull();
  });

  it('offers «no day» inside the month of an optional date while it holds one — chosen, it closes the month and says so', async () => {
    const { fixture, pill, calendar, piece } = await render();
    pill()?.click();
    fixture.detectChanges();
    // Nothing chosen: nothing to take back.
    expect(piece('last-clear')).toBeNull();

    fixture.componentInstance.selected.set(localDate('2026-11-20'));
    fixture.detectChanges();
    expect(piece('last-clear')?.textContent?.trim()).toBe('Без последен ден');

    piece('last-clear')?.click();
    fixture.detectChanges();
    expect(fixture.componentInstance.cleared).toBe(1);
    expect(calendar()).toBeNull();
    expect(piece('last-value')?.textContent?.trim()).toBe('Няма');
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
