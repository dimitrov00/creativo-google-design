import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { UiSlider } from './slider';

@Component({
  imports: [UiSlider],
  template: `<ui-slider
    uiId="pct"
    uiTestId="pct"
    uiLabel="Percent"
    [uiValue]="value()"
    [uiMin]="0"
    [uiMax]="100"
    [uiStep]="5"
    [uiTickEvery]="ticks()"
    [uiMajorEvery]="25"
    [uiMarks]="[
      { value: 0, label: '0%' },
      { value: 50, label: '50%' },
      { value: 100, label: '100%' },
    ]"
    [uiValueText]="'−' + value() + '%'"
    (uiValueChange)="value.set($event); moves.push($event)"
  />`,
})
class HostComponent {
  value = signal(15);
  ticks = signal<number | null>(5);
  moves: number[] = [];
}

describe('UiSlider', () => {
  let fixture: ComponentFixture<HostComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent],
    }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
  });

  const host = () =>
    fixture.nativeElement.querySelector('ui-slider') as HTMLElement;
  const native = () =>
    fixture.nativeElement.querySelector(
      '[data-testid="pct"]',
    ) as HTMLInputElement;

  it('is a native range underneath — the role, the bounds, the step and the words a reader hears', () => {
    expect(native().type).toBe('range');
    expect(native().id).toBe('pct');
    expect(native().min).toBe('0');
    expect(native().max).toBe('100');
    expect(native().step).toBe('5');
    expect(native().value).toBe('15');
    expect(native().getAttribute('aria-label')).toBe('Percent');
    expect(native().getAttribute('aria-valuetext')).toBe('−15%');
  });

  it('draws the ruler — a tick per step of the ruler, the taller ones where the owner says — and lights it to the value', () => {
    const rows = host().querySelectorAll('.ui-slider__ticks');
    expect(rows).toHaveLength(2);
    expect(rows[0].querySelectorAll('.ui-slider__tick')).toHaveLength(21);
    expect(
      rows[0].querySelectorAll('.ui-slider__tick[data-major]'),
    ).toHaveLength(5);
    expect(host().style.getPropertyValue('--ui-slider-fill')).toBe('0.15');
    expect(host().querySelector('.ui-slider__rail')).toBeNull();
  });

  it('draws the plain rail without ticks', () => {
    fixture.componentInstance.ticks.set(null);
    fixture.detectChanges();
    expect(host().querySelector('.ui-slider__ticks')).toBeNull();
    expect(host().querySelectorAll('.ui-slider__rail')).toHaveLength(2);
  });

  it('places the marks along the range', () => {
    const marks = [
      ...host().querySelectorAll('.ui-slider__mark'),
    ] as HTMLElement[];
    expect(marks.map((mark) => mark.textContent?.trim())).toEqual([
      '0%',
      '50%',
      '100%',
    ]);
    expect(
      marks.map((mark) => mark.style.getPropertyValue('--ui-slider-mark')),
    ).toEqual(['0', '0.5', '1']);
  });

  it('reports every move live, and follows the owner back', () => {
    native().value = '40';
    native().dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(fixture.componentInstance.moves).toEqual([40]);
    expect(host().style.getPropertyValue('--ui-slider-fill')).toBe('0.4');
    fixture.componentInstance.value.set(100);
    fixture.detectChanges();
    expect(native().value).toBe('100');
    expect(host().style.getPropertyValue('--ui-slider-fill')).toBe('1');
  });
});
