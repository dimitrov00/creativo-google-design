import { Component, signal } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { provideTransloco } from '@jsverse/transloco';
import { of } from 'rxjs';
import { afterEach, describe, expect, it } from 'vitest';
import { GridTimeScale } from '../grid-time-scale';
import { StaffTimeScaleSheet } from './staff-time-scale-sheet';

@Component({
  imports: [StaffTimeScaleSheet],
  template: `@if (open()) {
    <lib-staff-time-scale-sheet (closed)="open.set(false)" />
  }`,
})
class Host {
  readonly open = signal(true);
}

describe('StaffTimeScaleSheet', () => {
  let fixture: ComponentFixture<Host>;

  afterEach(() => localStorage.clear());

  async function mount(): Promise<GridTimeScale> {
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
    const scale = TestBed.inject(GridTimeScale);
    fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    await fixture.whenStable();
    return scale;
  }

  const press = (testId: string) => {
    (
      fixture.nativeElement.querySelector(
        `[data-testid="${testId}"]`,
      ) as HTMLElement | null
    )?.click();
    fixture.detectChanges();
  };
  const pressed = (testId: string) =>
    (fixture.nativeElement as HTMLElement)
      .querySelector(`[data-testid="${testId}"]`)
      ?.getAttribute('aria-pressed');

  it('drafts a scale on a tap, and takes it to the calendar only on «Приложи», which closes', async () => {
    const scale = await mount();
    expect(pressed('staff-scale-15')).toBe('true');
    press('staff-scale-60');
    expect(pressed('staff-scale-60')).toBe('true');
    expect(scale.minutes()).toBe(15);
    press('staff-scale-apply');
    expect(scale.minutes()).toBe(60);
    expect(fixture.componentInstance.open()).toBe(false);
  });

  it('opens on the scale the calendar draws now', async () => {
    localStorage.setItem('staff-schedule-time-scale', '30');
    await mount();
    expect(pressed('staff-scale-30')).toBe('true');
    expect(pressed('staff-scale-15')).toBe('false');
  });
});
