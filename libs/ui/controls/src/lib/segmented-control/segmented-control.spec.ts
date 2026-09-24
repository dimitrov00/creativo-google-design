import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { UiMaterialDirective } from '@creativo/ui/modifiers';
import { type UiSegment, UiSegmentedControl } from './segmented-control';

@Component({
  imports: [UiSegmentedControl, UiMaterialDirective],
  template: `<ui-segmented-control
    [uiSegments]="segments"
    [uiSelectedId]="selected()"
    [uiControlSize]="size"
    uiLabel="Scope"
    (uiPicked)="selected.set($event)"
  />`,
})
class HostComponent {
  segments: readonly UiSegment[] = [
    { id: 'day', label: 'Day', testId: 'seg-day' },
    { id: 'week', label: 'Week', testId: 'seg-week' },
    { id: 'month', label: 'Month', testId: 'seg-month', disabled: true },
    { id: 'year', label: 'Year', testId: 'seg-year' },
  ];
  readonly selected = signal<string | null>('week');
  size: 'small' | 'regular' = 'small';
}

@Component({
  imports: [UiSegmentedControl, UiMaterialDirective],
  template: `<ui-segmented-control
    [uiSegments]="segments"
    uiSelectedId="map"
    uiMaterial="thick"
    uiShape="capsule"
    uiLabel="View"
  />`,
})
class IconHostComponent {
  segments: readonly UiSegment[] = [
    { id: 'map', label: 'Map', icon: 'location.place', iconOnly: true },
    { id: 'list', label: 'List', icon: 'view.list', iconOnly: true },
  ];
}

describe('UiSegmentedControl', () => {
  let fixture: ComponentFixture<HostComponent>;
  const radios = () =>
    Array.from(
      (
        fixture.nativeElement as HTMLElement
      ).querySelectorAll<HTMLButtonElement>('[role="radio"]'),
    );
  const host = () =>
    (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>(
      'ui-segmented-control',
    );

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent, IconHostComponent],
    }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
  });

  it('is a radiogroup of equal segments, the chosen one checked and raised, the rest one tab stop away', () => {
    expect(host()?.getAttribute('role')).toBe('radiogroup');
    expect(host()?.getAttribute('aria-label')).toBe('Scope');
    expect(host()?.getAttribute('data-control-size')).toBe('small');
    expect(host()?.hasAttribute('data-empty')).toBe(false);
    expect(host()?.style.getPropertyValue('--ui-segmented-count')).toBe('4');
    expect(host()?.style.getPropertyValue('--ui-segmented-index')).toBe('1');
    expect(radios().map((radio) => radio.getAttribute('data-testid'))).toEqual([
      'seg-day',
      'seg-week',
      'seg-month',
      'seg-year',
    ]);
    expect(radios().map((radio) => radio.getAttribute('aria-checked'))).toEqual(
      ['false', 'true', 'false', 'false'],
    );
    expect(radios()[1]?.hasAttribute('data-selected')).toBe(true);
    expect(radios()[1]?.textContent?.trim()).toBe('Week');
    // One tab stop — the chosen segment; arrows do the rest.
    expect(radios().map((radio) => radio.getAttribute('tabindex'))).toEqual([
      '-1',
      '0',
      '-1',
      '-1',
    ]);
    expect(radios()[2]?.disabled).toBe(true);
    expect(
      host()?.querySelector('.ui-segmented-control__thumb'),
    ).not.toBeNull();
  });

  it('picks on a tap, never on a disabled segment', () => {
    radios()[3]?.click();
    fixture.detectChanges();
    expect(fixture.componentInstance.selected()).toBe('year');
    expect(host()?.style.getPropertyValue('--ui-segmented-index')).toBe('3');
    radios()[2]?.click();
    fixture.detectChanges();
    expect(fixture.componentInstance.selected()).toBe('year');
  });

  it('moves the choice with the arrows, skipping a disabled segment and wrapping, Home and End to the ends', () => {
    const press = (key: string, at: number) => {
      radios()[at]?.dispatchEvent(
        new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
      );
      fixture.detectChanges();
    };
    press('ArrowRight', 1);
    expect(fixture.componentInstance.selected()).toBe('year');
    press('ArrowRight', 3);
    expect(fixture.componentInstance.selected()).toBe('day');
    press('ArrowLeft', 0);
    expect(fixture.componentInstance.selected()).toBe('year');
    press('Home', 3);
    expect(fixture.componentInstance.selected()).toBe('day');
    press('End', 0);
    expect(fixture.componentInstance.selected()).toBe('year');
  });

  it('hides the thumb and hands the tab stop to the first segment while nothing is chosen', () => {
    fixture.componentInstance.selected.set(null);
    fixture.detectChanges();
    expect(host()?.hasAttribute('data-empty')).toBe(true);
    expect(host()?.style.getPropertyValue('--ui-segmented-index')).toBe('0');
    expect(
      radios().every((radio) => radio.getAttribute('aria-checked') === 'false'),
    ).toBe(true);
    expect(radios()[0]?.getAttribute('tabindex')).toBe('0');
  });

  it('renders the regular size on request', () => {
    const regular = TestBed.createComponent(HostComponent);
    regular.componentInstance.size = 'regular';
    regular.detectChanges();
    expect(
      (regular.nativeElement as HTMLElement)
        .querySelector('ui-segmented-control')
        ?.getAttribute('data-control-size'),
    ).toBe('regular');
  });

  it('keeps the words as the accessible name of an icon-only segment, and takes a material on the host', () => {
    const icons = TestBed.createComponent(IconHostComponent);
    icons.detectChanges();
    const root = icons.nativeElement as HTMLElement;
    const control = root.querySelector('ui-segmented-control');
    expect(control?.getAttribute('data-material')).toBe('thick');
    expect(control?.getAttribute('data-shape')).toBe('capsule');
    expect(host()?.getAttribute('data-shape')).toBe('rounded');
    const [map, list] = Array.from(root.querySelectorAll('[role="radio"]'));
    expect(map?.getAttribute('aria-label')).toBe('Map');
    expect(map?.hasAttribute('data-icon-only')).toBe(true);
    expect(map?.querySelector('ui-icon')).not.toBeNull();
    expect(map?.querySelector('.ui-segmented-control__label')).toBeNull();
    expect(list?.getAttribute('aria-checked')).toBe('false');
  });
});
