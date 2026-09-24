import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { UiWeekdayPicker } from './weekday-picker';

@Component({
  imports: [UiWeekdayPicker],
  template: `<ui-weekday-picker
    [uiSelected]="selected()"
    uiLocale="bg"
    uiLabel="Дни"
    uiTestId="day"
    (uiSelectedChange)="selected.set($event)"
  />`,
})
class HostComponent {
  readonly selected = signal<readonly number[]>([1, 3]);
}

describe('UiWeekdayPicker', () => {
  let fixture: ComponentFixture<HostComponent>;
  const toggle = (iso: number) =>
    (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>(
      `[data-testid="day-${iso}"]`,
    );
  const press = (iso: number) => {
    toggle(iso)?.click();
    fixture.detectChanges();
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent],
    }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
  });

  it('draws the week Monday first, short on the circle, whole for a reader', () => {
    const group = (fixture.nativeElement as HTMLElement).querySelector(
      '[role="group"]',
    );
    expect(group?.getAttribute('aria-label')).toBe('Дни');
    expect(toggle(1)?.textContent?.trim()).toBe('пн');
    expect(toggle(1)?.getAttribute('aria-label')).toBe('понеделник');
    expect(toggle(7)?.textContent?.trim()).toBe('нд');
    expect(toggle(1)?.getAttribute('aria-pressed')).toBe('true');
    expect(toggle(2)?.getAttribute('aria-pressed')).toBe('false');
  });

  it('toggles a day on and off, and answers in ISO order', () => {
    press(7);
    press(2);
    expect(fixture.componentInstance.selected()).toEqual([1, 2, 3, 7]);
    press(1);
    expect(fixture.componentInstance.selected()).toEqual([2, 3, 7]);
  });

  it('never lets the last day go', () => {
    press(1);
    expect(fixture.componentInstance.selected()).toEqual([3]);
    expect(toggle(3)?.getAttribute('aria-disabled')).toBe('true');
    press(3);
    // Still on: a week with no days never occurs.
    expect(fixture.componentInstance.selected()).toEqual([3]);
    expect(toggle(3)?.getAttribute('aria-pressed')).toBe('true');
    press(5);
    expect(toggle(3)?.hasAttribute('aria-disabled')).toBe(false);
  });
});
