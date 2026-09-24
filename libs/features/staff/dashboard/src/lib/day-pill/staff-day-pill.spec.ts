import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  StaffDayPill,
  formatDayPill,
  formatDayPillRange,
} from './staff-day-pill';

describe('StaffDayPill', () => {
  let fixture: ComponentFixture<StaffDayPill>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [StaffDayPill],
    }).compileComponents();
    fixture = TestBed.createComponent(StaffDayPill);
    fixture.componentRef.setInput('uiDayKey', '2026-09-09');
    fixture.componentRef.setInput('uiLocale', 'bg');
    fixture.detectChanges();
  });

  const host = () => fixture.nativeElement as HTMLElement;
  const trigger = () =>
    host().querySelector<HTMLButtonElement>('[data-testid="staff-day-pill"]');

  it("names the day the one way: the locale's own compact date, weekday first", () => {
    expect(formatDayPill('2026-09-09', 'bg')).toBe('ср, 9.09');
    expect(formatDayPill('2026-09-09', 'en')).toBe('Wed, Sep 9');
    expect(trigger()?.textContent?.replace(/\s+/g, ' ').trim()).toContain(
      'ср, 9.09',
    );
  });

  it('names a period in the same numeric grammar, the shared month said once', () => {
    // Inside one month the month is written once, on the side the locale
    // puts it (2026-09-23): «21 – 27.09» in Bulgarian, «Sep 21 – 27» in
    // English — the long-month range («21 – 27 Септември») pushed the
    // toolbar's cluster off a 390px bar.
    expect(formatDayPillRange('2026-09-21', '2026-09-27', 'bg')).toBe(
      '21 – 27.09',
    );
    expect(formatDayPillRange('2026-09-21', '2026-09-27', 'en')).toBe(
      'Sep 21 – 27',
    );
    // Across a month both dates carry theirs, in Intl's own range form —
    // which sets the dash in thin spaces in English; the words are what is
    // pinned, not the whitespace.
    const plain = (text: string) => text.replace(/\s/g, ' ');
    expect(plain(formatDayPillRange('2026-09-30', '2026-10-02', 'bg'))).toBe(
      '30.09 – 2.10',
    );
    expect(plain(formatDayPillRange('2026-09-30', '2026-10-02', 'en'))).toBe(
      'Sep 30 – Oct 2',
    );
    // Across a year the years come along — the one time they are news.
    expect(plain(formatDayPillRange('2026-12-28', '2027-01-03', 'en'))).toBe(
      'Dec 28, 2026 – Jan 3, 2027',
    );
  });

  it('opens the month on press and closes it on a pick, reporting both', () => {
    const presented: boolean[] = [];
    const picked: string[] = [];
    fixture.componentInstance.uiPresented.subscribe((v) => presented.push(v));
    fixture.componentInstance.uiPicked.subscribe((d) => picked.push(d));
    expect(
      host().querySelector('[data-testid="staff-day-pill-calendar"]'),
    ).toBeNull();
    trigger()?.click();
    fixture.detectChanges();
    expect(
      host().querySelector('[data-testid="staff-day-pill-calendar"]'),
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
      host().querySelector('[data-testid="staff-day-pill-calendar"]'),
    ).toBeNull();
  });

  it("takes an owner label over the day's own — the toolbar's week range", () => {
    fixture.componentRef.setInput('uiLabel', '7 – 13 септември');
    fixture.detectChanges();
    expect(trigger()?.textContent).toContain('7 – 13 септември');
  });
});
