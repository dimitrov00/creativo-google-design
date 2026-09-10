import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { StaffDayPill, formatDayPill } from './staff-day-pill';

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
