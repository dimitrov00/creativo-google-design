import { Component, signal } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { provideTransloco } from '@jsverse/transloco';
import { of } from 'rxjs';
import { afterEach, describe, expect, it } from 'vitest';
import { BookingStatus } from '@core/primitives';
import { ScheduleStatusFilter } from '../schedule-status-filter';
import { StaffStatusFilterSheet } from './staff-status-filter-sheet';

@Component({
  imports: [StaffStatusFilterSheet],
  template: `@if (open()) {
    <lib-staff-status-filter-sheet (closed)="open.set(false)" />
  }`,
})
class Host {
  readonly open = signal(true);
}

describe('StaffStatusFilterSheet', () => {
  let fixture: ComponentFixture<Host>;

  afterEach(() => localStorage.clear());

  async function mount(): Promise<ScheduleStatusFilter> {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [Host],
      providers: [
        provideTransloco({
          config: {
            availableLangs: ['bg'],
            defaultLang: 'bg',
            missingHandler: { logMissingKey: false },
          },
          loader: class {
            getTranslation() {
              return of({});
            }
          },
        }),
      ],
    });
    const filter = TestBed.inject(ScheduleStatusFilter);
    fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    await fixture.whenStable();
    return filter;
  }

  const el = <T extends HTMLElement>(testId: string) =>
    fixture.nativeElement.querySelector(
      `[data-testid="${testId}"]`,
    ) as T | null;
  const press = (testId: string) => {
    el<HTMLButtonElement>(testId)?.click();
    fixture.detectChanges();
  };

  it('edits a draft: the schedule changes only on «Приложи», which closes the sheet', async () => {
    const filter = await mount();
    press('staff-status-CANCELLED');
    press('staff-status-blocks');
    expect(filter.hidden()).toEqual([]);
    expect(filter.blocksShown()).toBe(true);

    press('staff-status-apply');
    expect(filter.hidden()).toEqual([BookingStatus.Cancelled]);
    expect(filter.blocksShown()).toBe(false);
    expect(fixture.componentInstance.open()).toBe(false);
  });

  it('greys «Нулирай» until something is hidden, and resets the draft only', async () => {
    const filter = await mount();
    expect(el<HTMLButtonElement>('staff-status-reset')?.disabled).toBe(true);
    press('staff-status-NO_SHOW');
    expect(el<HTMLButtonElement>('staff-status-reset')?.disabled).toBe(false);

    press('staff-status-reset');
    expect(el<HTMLButtonElement>('staff-status-reset')?.disabled).toBe(true);
    expect(filter.hidden()).toEqual([]);
  });

  it('opens on what the schedule draws now', async () => {
    localStorage.setItem(
      'staff-schedule-hidden-statuses',
      JSON.stringify([BookingStatus.Completed]),
    );
    await mount();
    expect(el('staff-status-COMPLETED')?.getAttribute('aria-checked')).toBe(
      'false',
    );
    expect(el<HTMLButtonElement>('staff-status-reset')?.disabled).toBe(false);
  });
});
