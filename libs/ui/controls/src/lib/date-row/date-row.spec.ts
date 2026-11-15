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
      [uiValue]="value()"
      [uiToday]="today"
      [uiMin]="min()"
      [uiMarked]="marked()"
      [uiDisabled]="disabled()"
      [(uiExpanded)]="expanded"
      (uiPicked)="onPicked($event)"
    />
  `,
})
class Host {
  readonly selected = signal<LocalDate | null>(null);
  readonly value = signal<string | null>(null);
  readonly min = signal<LocalDate | null>(localDate('2026-11-10'));
  readonly marked = signal<readonly LocalDate[]>([localDate('2026-11-18')]);
  readonly disabled = signal(false);
  readonly expanded = signal(false);
  readonly today = localDate('2026-11-15');
  picked: LocalDate[] = [];
  /** The consumer folds the month once a day is picked. */
  foldsOnPick = false;

  onPicked(day: LocalDate): void {
    this.picked.push(day);
    if (this.foldsOnPick) this.expanded.set(false);
  }
}

async function render() {
  await TestBed.configureTestingModule({ imports: [Host] }).compileComponents();
  const fixture = TestBed.createComponent(Host);
  fixture.detectChanges();
  const host = fixture.nativeElement as HTMLElement;
  const row = () =>
    host.querySelector<HTMLButtonElement>('[data-testid="last"]');
  const calendar = () =>
    host.querySelector<HTMLElement>('[data-testid="last-calendar"]');
  const day = (key: string) =>
    host.querySelector<HTMLButtonElement>(
      `[data-testid="ui-month-day-${key}"]`,
    );
  return { fixture, host, row, calendar, day };
}

describe('UiDateRow', () => {
  it('says the placeholder in secondary ink while it holds no day, and the day once it does', async () => {
    const { fixture, host } = await render();
    const value = () =>
      host.querySelector<HTMLElement>('[data-testid="last-value"]');

    expect(value()?.textContent?.trim()).toBe('Няма');
    expect(value()?.getAttribute('data-foreground-style')).toBe('secondary');

    fixture.componentInstance.selected.set(localDate('2026-11-20'));
    fixture.componentInstance.value.set('20 ноември');
    fixture.detectChanges();

    expect(value()?.textContent?.trim()).toBe('20 ноември');
    expect(value()?.getAttribute('data-foreground-style')).toBe('primary');
  });

  it('keeps the month folded until the row is pressed, and says so to a reader', async () => {
    const { fixture, row, calendar } = await render();

    expect(calendar()).toBeNull();
    expect(row()?.getAttribute('aria-expanded')).toBe('false');

    row()?.click();
    fixture.detectChanges();

    expect(row()?.getAttribute('aria-expanded')).toBe('true');
    expect(calendar()?.id).toBe(row()?.getAttribute('aria-controls'));
    expect(fixture.componentInstance.expanded()).toBe(true);

    row()?.click();
    fixture.detectChanges();

    expect(calendar()).toBeNull();
    expect(fixture.componentInstance.expanded()).toBe(false);
  });

  it('opens an empty row on its floor’s month, dots the marked days and refuses the days before the floor', async () => {
    const { fixture, day } = await render();
    fixture.componentInstance.expanded.set(true);
    fixture.detectChanges();

    expect(day('2026-11-18')?.hasAttribute('data-marked')).toBe(true);
    expect(day('2026-11-17')?.hasAttribute('data-marked')).toBe(false);
    expect(day('2026-11-09')?.disabled).toBe(true);
    expect(day('2026-11-10')?.disabled).toBe(false);
  });

  it('hands the picked day up and leaves folding to the consumer', async () => {
    const { fixture, day, calendar } = await render();
    fixture.componentInstance.expanded.set(true);
    fixture.detectChanges();

    day('2026-11-20')?.click();
    fixture.detectChanges();

    expect(fixture.componentInstance.picked).toEqual([localDate('2026-11-20')]);
    expect(calendar()).not.toBeNull();
  });

  it('takes the keyboard back when the consumer folds the month on a pick', async () => {
    const { fixture, row, day, calendar } = await render();
    document.body.appendChild(fixture.nativeElement as HTMLElement);
    try {
      fixture.componentInstance.expanded.set(true);
      fixture.detectChanges();
      const cell = day('2026-11-20');
      cell?.focus();
      // The consumer's answer to a pick: fold the month.
      fixture.componentInstance.foldsOnPick = true;
      cell?.click();
      fixture.detectChanges();
      await fixture.whenStable();

      expect(calendar()).toBeNull();
      expect(document.activeElement).toBe(row());
    } finally {
      (fixture.nativeElement as HTMLElement).remove();
    }
  });

  it('answers nothing while disabled', async () => {
    const { fixture, row, calendar } = await render();
    fixture.componentInstance.disabled.set(true);
    fixture.detectChanges();

    expect(row()?.disabled).toBe(true);
    row()?.click();
    fixture.detectChanges();

    expect(calendar()).toBeNull();
  });
});
