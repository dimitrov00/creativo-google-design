import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { localDate } from '@core/testing';
import { formatDayPill, formatDayPillRange } from '@creativo/ui/wall-clock';
import { UiDatePill } from './date-pill';

describe('UiDatePill', () => {
  let fixture: ComponentFixture<UiDatePill>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [UiDatePill],
    }).compileComponents();
    fixture = TestBed.createComponent(UiDatePill);
    fixture.componentRef.setInput('uiSelected', '2026-09-09');
    fixture.componentRef.setInput('uiLocale', 'bg');
    fixture.detectChanges();
  });

  const host = () => fixture.nativeElement as HTMLElement;
  const trigger = () =>
    host().querySelector<HTMLButtonElement>('[data-testid="ui-date-pill"]');

  it("names the day the one way: the locale's own compact date, weekday first", () => {
    expect(formatDayPill(localDate('2026-09-09'), 'bg')).toBe('ср, 9.09');
    expect(formatDayPill(localDate('2026-09-09'), 'en')).toBe('Wed, Sep 9');
    expect(trigger()?.textContent?.replace(/\s+/g, ' ').trim()).toContain(
      'ср, 9.09',
    );
  });

  it('names a period in the same numeric grammar, the shared month said once', () => {
    // Inside one month the month is written once, on the side the locale
    // puts it (2026-09-23): «21 – 27.09» in Bulgarian, «Sep 21 – 27» in
    // English — the long-month range («21 – 27 Септември») pushed the
    // toolbar's cluster off a 390px bar.
    expect(
      formatDayPillRange(
        localDate('2026-09-21'),
        localDate('2026-09-27'),
        'bg',
      ),
    ).toBe('21 – 27.09');
    expect(
      formatDayPillRange(
        localDate('2026-09-21'),
        localDate('2026-09-27'),
        'en',
      ),
    ).toBe('Sep 21 – 27');
    // Across a month both dates carry theirs, in Intl's own range form —
    // which sets the dash in thin spaces in English; the words are what is
    // pinned, not the whitespace.
    const plain = (text: string) => text.replace(/\s/g, ' ');
    expect(
      plain(
        formatDayPillRange(
          localDate('2026-09-30'),
          localDate('2026-10-02'),
          'bg',
        ),
      ),
    ).toBe('30.09 – 2.10');
    expect(
      plain(
        formatDayPillRange(
          localDate('2026-09-30'),
          localDate('2026-10-02'),
          'en',
        ),
      ),
    ).toBe('Sep 30 – Oct 2');
    // Across a year the years come along — the one time they are news.
    expect(
      plain(
        formatDayPillRange(
          localDate('2026-12-28'),
          localDate('2027-01-03'),
          'en',
        ),
      ),
    ).toBe('Dec 28, 2026 – Jan 3, 2027');
  });

  it('opens the month on press and closes it on a pick, reporting both', () => {
    const presented: boolean[] = [];
    const picked: string[] = [];
    fixture.componentInstance.uiPresented.subscribe((v) => presented.push(v));
    fixture.componentInstance.uiPicked.subscribe((d) => picked.push(d));
    expect(
      host().querySelector('[data-testid="ui-date-pill-calendar"]'),
    ).toBeNull();
    trigger()?.click();
    fixture.detectChanges();
    expect(
      host().querySelector('[data-testid="ui-date-pill-calendar"]'),
    ).not.toBeNull();
    // The month's own cells are the DS's to test; the contract here is the
    // pill's: a pick closes it and names the day.
    (
      fixture.componentInstance as unknown as { pick: (d: string) => void }
    ).pick('2026-09-12');
    fixture.detectChanges();
    expect(picked).toEqual(['2026-09-12']);
    expect(presented).toEqual([true, false]);
    expect(
      host().querySelector('[data-testid="ui-date-pill-calendar"]'),
    ).toBeNull();
  });

  it('draws no foot under the month unless asked: no legend, and no «no day» answer for a date that is always set', () => {
    fixture.componentRef.setInput('uiMarked', ['2026-09-12']);
    trigger()?.click();
    fixture.detectChanges();
    expect(host().querySelector('.ui-date-pill__footer')).toBeNull();

    fixture.componentRef.setInput('uiMarkedLabel', 'Дни със записи');
    fixture.componentRef.setInput('uiClearLabel', 'Без дата');
    fixture.detectChanges();
    expect(
      host().querySelector('[data-testid="ui-date-pill-legend"]')?.textContent,
    ).toContain('Дни със записи');
    expect(
      host().querySelector('[data-testid="ui-date-pill-clear"]')?.textContent,
    ).toContain('Без дата');
  });

  it('prints its placeholder in the secondary ink while it holds no day', () => {
    fixture.componentRef.setInput('uiSelected', null);
    fixture.componentRef.setInput('uiPlaceholder', 'Няма');
    fixture.detectChanges();
    expect(trigger()?.textContent?.replace(/\s+/g, ' ').trim()).toContain(
      'Няма',
    );
    expect(trigger()?.hasAttribute('data-empty')).toBe(true);
  });

  it('reads «label: day» when a row names the value beside it, and names its month after it', () => {
    fixture.componentRef.setInput('uiAccessibleLabel', 'Начална дата');
    fixture.detectChanges();
    expect(trigger()?.getAttribute('aria-label')).toBe(
      'Начална дата: ср, 9.09',
    );
  });

  it("takes an owner label over the day's own — the toolbar's week range", () => {
    fixture.componentRef.setInput('uiLabel', '7 – 13 септември');
    fixture.detectChanges();
    expect(trigger()?.textContent).toContain('7 – 13 септември');
  });

  /*
   * ── THE POPOVER IS A DIALOG (2026-10-06) ───────────────────────────
   * A month has no menuitems: announced as `role="menu"` it was an empty
   * menu to a reader (axe `aria-required-children`, critical, on every
   * run of the review's capture). The DS surface is asked for its dialog
   * form, named after the pill's own label.
   */
  const surface = () => host().querySelector<HTMLElement>('.ui-menu__surface');

  async function open(): Promise<void> {
    trigger()?.click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  it('presents the month as a non-modal dialog named for the day — never an empty menu', async () => {
    await open();
    expect(surface()?.getAttribute('role')).toBe('dialog');
    expect(surface()?.getAttribute('aria-modal')).toBe('false');
    expect(surface()?.getAttribute('aria-label')).toBe('ср, 9.09');
    expect(trigger()?.getAttribute('aria-haspopup')).toBe('dialog');
    expect(trigger()?.getAttribute('aria-expanded')).toBe('true');
    // Nothing in it claims to be a menu item: the days are the month's own buttons.
    expect(surface()?.querySelector('[role="menuitem"]')).toBeNull();
    expect(
      surface()?.querySelector('[data-testid="ui-date-pill-calendar"]'),
    ).not.toBeNull();
  });

  it('takes focus as a container on open, and Escape closes it with focus back on the pill', async () => {
    await open();
    expect(document.activeElement).toBe(surface());
    surface()?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );
    fixture.detectChanges();
    expect(fixture.componentInstance.uiPresented()).toBe(false);
    expect(document.activeElement).toBe(trigger());
    expect(trigger()?.getAttribute('aria-expanded')).toBe('false');
  });
});
