import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { UiMonthPicker } from './month-picker';

@Component({
  imports: [UiMonthPicker],
  template: `
    <ui-month-picker
      [uiSelected]="selected()"
      [uiToday]="today()"
      uiLocale="bg"
      [uiRelatives]="relatives"
      [uiMarked]="marked()"
      [uiMin]="min()"
      (uiPicked)="picked.push($event)"
    />
  `,
})
class Host {
  readonly selected = signal('2026-08-26');
  readonly today = signal('2026-08-24');
  readonly marked = signal<readonly string[]>([]);
  readonly min = signal<string | null>(null);
  readonly relatives = [
    { offset: 0, label: 'Днес' },
    { offset: 1, label: 'Утре' },
  ];
  picked: string[] = [];
}

async function render() {
  await TestBed.configureTestingModule({ imports: [Host] }).compileComponents();
  const fixture = TestBed.createComponent(Host);
  fixture.detectChanges();
  return { fixture, host: fixture.nativeElement as HTMLElement };
}

const day = (host: HTMLElement, key: string) =>
  host.querySelector<HTMLElement>(`[data-testid="ui-month-day-${key}"]`);

describe('UiMonthPicker', () => {
  /*
   * The bug this component exists to stop being fixed twice: BOTH
   * hand-rolled pickers rendered bare numerals, so neither highlighted the
   * selected day or today. Somebody found that, fixed it, and found it again
   * in the other file.
   */
  it('marks the selected day and today, and keeps them separable', async () => {
    const { host } = await render();

    const selected = day(host, '2026-08-26');
    expect(selected?.getAttribute('aria-current')).toBe('date');
    expect(
      selected?.querySelector('ui-date-badge')?.getAttribute('data-state'),
    ).toBe('selected');

    const today = day(host, '2026-08-24');
    expect(today?.getAttribute('aria-current')).toBeNull();
    // `uiToday` is its own flag rather than a state, so a selected today
    // still says it is today.
    expect(
      today?.querySelector('ui-date-badge')?.hasAttribute('data-today'),
    ).toBe(true);
  });

  it('lays the month out Monday-first, with the right lead', async () => {
    const { host } = await render();

    const weekdays = [...host.querySelectorAll('[uiweekday]')].map((el) =>
      el.textContent?.trim(),
    );
    expect(weekdays.length).toBe(7);
    expect(weekdays[0]).toBe('пн');
    expect(weekdays[6]).toBe('нд');

    // 1 Aug 2026 is a Saturday, so the month opens with five blanks.
    const cells = [...host.querySelectorAll('ui-calendar-grid > *')].slice(7);
    const firstDay = cells.findIndex(
      (el) => el.getAttribute('data-testid') === 'ui-month-day-2026-08-01',
    );
    expect(firstDay).toBe(5);
    expect(day(host, '2026-08-31')).not.toBeNull();
    expect(day(host, '2026-09-01')).toBeNull();
  });

  /* Browsing is not choosing: paging must never move the selection. */
  it('pages the month without touching the selection', async () => {
    const { fixture, host } = await render();

    host.querySelector<HTMLElement>('[data-testid="ui-month-next"]')?.click();
    fixture.detectChanges();

    expect(day(host, '2026-09-15')).not.toBeNull();
    expect(day(host, '2026-08-26')).toBeNull();
    expect(fixture.componentInstance.picked).toEqual([]);
    expect(fixture.componentInstance.selected()).toBe('2026-08-26');
  });

  /*
   * ⚠ A paged month must SURVIVE an unrelated recompute. The browsed month
   * is a `linkedSignal` carrying `previous` forward for exactly this: source
   * equality is not what re-derivation keys on, so without it the grid
   * snapped back to the selection whenever anything else changed.
   */
  it('keeps the browsed month when something unrelated changes', async () => {
    const { fixture, host } = await render();

    host.querySelector<HTMLElement>('[data-testid="ui-month-next"]')?.click();
    fixture.detectChanges();
    expect(day(host, '2026-09-15')).not.toBeNull();

    fixture.componentInstance.today.set('2026-08-25');
    fixture.detectChanges();

    expect(day(host, '2026-09-15')).not.toBeNull();
  });

  it('lands back on the selection when the selection moves', async () => {
    const { fixture, host } = await render();

    host.querySelector<HTMLElement>('[data-testid="ui-month-next"]')?.click();
    fixture.detectChanges();
    fixture.componentInstance.selected.set('2026-11-04');
    fixture.detectChanges();

    expect(day(host, '2026-11-04')?.getAttribute('aria-current')).toBe('date');
  });

  it('emits the day a cell names', async () => {
    const { fixture, host } = await render();

    day(host, '2026-08-30')?.click();
    fixture.detectChanges();

    expect(fixture.componentInstance.picked).toEqual(['2026-08-30']);
  });

  /* Resolved against `uiToday`, so a shortcut cannot drift from the shop's
     own today the way a locally-computed date could. */
  it('resolves relative shortcuts against today, not the device clock', async () => {
    const { fixture, host } = await render();

    host
      .querySelector<HTMLElement>('[data-testid="ui-month-relative-1"]')
      ?.click();
    fixture.detectChanges();

    expect(fixture.componentInstance.picked).toEqual(['2026-08-25']);
  });

  it('offers no shortcuts unless a consumer asks', async () => {
    await TestBed.configureTestingModule({
      imports: [Host],
    }).compileComponents();
    const fixture = TestBed.createComponent(Host);
    fixture.componentInstance.relatives.length = 0;
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;

    expect(host.querySelector('.ui-month-picker__relatives')).toBeNull();
  });

  /* A series' days on the calendar that picks where it ends (2026-09-24):
     the badge's event dot, and nothing before the start answers. */
  it('dots the marked days, and holds back the ones before the minimum', async () => {
    const { fixture, host } = await render();
    fixture.componentInstance.marked.set(['2026-08-20', '2026-08-27']);
    fixture.componentInstance.min.set('2026-08-20');
    fixture.detectChanges();

    const marked = day(host, '2026-08-27');
    expect(marked?.hasAttribute('data-marked')).toBe(true);
    expect(marked?.querySelector('.ui-date-badge__marker')).not.toBeNull();
    expect(
      day(host, '2026-08-28')?.querySelector('.ui-date-badge__marker'),
    ).toBeNull();

    const early = day(host, '2026-08-19') as HTMLButtonElement | null;
    expect(early?.disabled).toBe(true);
    expect(
      early?.querySelector('ui-date-badge')?.getAttribute('data-state'),
    ).toBe('unavailable');
    early?.click();
    day(host, '2026-08-20')?.click();
    fixture.detectChanges();
    expect(fixture.componentInstance.picked).toEqual(['2026-08-20']);
  });
});
