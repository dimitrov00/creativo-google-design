import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { UiMarkScale, visibleMarks, type UiMark } from './mark-scale';

const mark = (value: number, label: string | null): UiMark => ({
  value,
  label,
});

describe('visibleMarks', () => {
  it('keeps the labelled marks inside the range, in value order', () => {
    const shown = visibleMarks(
      [mark(400, '400 т.'), mark(120, '120 т.'), mark(250, '250 т.')],
      0,
      400,
      0.12,
    );
    expect(shown.map((m) => m.label)).toEqual(['120 т.', '250 т.', '400 т.']);
  });

  it('drops a notch without words and a point outside the range', () => {
    const shown = visibleMarks(
      [
        mark(-10, 'below'),
        mark(20, null),
        mark(30, ''),
        mark(50, 'mid'),
        mark(120, 'above'),
      ],
      0,
      100,
      0.12,
    );
    expect(shown.map((m) => m.label)).toEqual(['mid']);
  });

  it('drops a label closer than the gap to the previous one SHOWN, not to the previous one given', () => {
    // 0 · 0.05 (dropped: 0.05 from 0) · 0.1 (0.1 from the shown 0: dropped)
    // · 0.15 (0.15 from 0: shown) · 1.
    const shown = visibleMarks(
      [
        mark(0, 'a'),
        mark(5, 'b'),
        mark(10, 'c'),
        mark(15, 'd'),
        mark(100, 'e'),
      ],
      0,
      100,
      0.12,
    );
    expect(shown.map((m) => m.label)).toEqual(['a', 'd', 'e']);
  });

  it('keeps a label exactly one gap away', () => {
    const shown = visibleMarks([mark(0, 'a'), mark(25, 'b')], 0, 100, 0.25);
    expect(shown.map((m) => m.label)).toEqual(['a', 'b']);
  });

  it('shows nothing on an empty or inverted range', () => {
    expect(visibleMarks([mark(0, 'a')], 5, 5, 0.12)).toEqual([]);
    expect(visibleMarks([mark(0, 'a')], 10, 0, 0.12)).toEqual([]);
  });
});

@Component({
  imports: [UiMarkScale],
  template: `<ui-mark-scale
    [uiMarks]="marks()"
    [uiMin]="0"
    [uiMax]="400"
    [uiMinGap]="gap()"
  />`,
})
class Host {
  readonly marks = signal<readonly UiMark[]>([
    { value: 0, label: 'Бронз' },
    { value: 120, label: 'Брада', detail: ['120 т.'] },
    {
      value: 250,
      label: 'Подстригване',
      detail: ['250 т.', 'още 42', 'extra'],
    },
    { value: 400, label: 'Продукт' },
    { value: 300, label: null },
  ]);
  readonly gap = signal(0.12);
}

function render() {
  TestBed.configureTestingModule({
    imports: [Host],
    errorOnUnknownElements: true,
    errorOnUnknownProperties: true,
  });
  const fixture = TestBed.createComponent(Host);
  fixture.detectChanges();
  const scale = fixture.nativeElement.querySelector(
    'ui-mark-scale',
  ) as HTMLElement;
  const marks = () => [
    ...scale.querySelectorAll<HTMLElement>('.ui-mark-scale__mark'),
  ];
  return { fixture, scale, marks };
}

describe('UiMarkScale', () => {
  it('is decoration to a reader: the meter or slider that owns it says the value', () => {
    const { scale } = render();
    expect(scale.classList.contains('ui-mark-scale')).toBe(true);
    expect(scale.getAttribute('aria-hidden')).toBe('true');
  });

  it('places each word at its ratio along the range, the ends hugging their edges', () => {
    const { marks } = render();
    expect(
      marks().map((m) => m.querySelector('.ui-mark-scale__label')?.textContent),
    ).toEqual(['Бронз', 'Брада', 'Подстригване', 'Продукт']);
    expect(
      marks().map((m) => m.style.getPropertyValue('--ui-mark-scale-ratio')),
    ).toEqual(['0', '0.3', '0.625', '1']);
    expect(marks().map((m) => m.dataset['align'])).toEqual([
      'start',
      'center',
      'center',
      'end',
    ]);
  });

  it('writes at most two detail lines under a label', () => {
    const { marks } = render();
    const details = (index: number) =>
      [
        ...(marks().at(index)?.querySelectorAll('.ui-mark-scale__detail') ??
          []),
      ].map((line) => line.textContent);
    expect(details(0)).toEqual([]);
    expect(details(1)).toEqual(['120 т.']);
    expect(details(2)).toEqual(['250 т.', 'още 42']);
  });

  it('drops a word that would overprint its neighbour, and brings it back when there is room', () => {
    const { fixture, marks } = render();
    fixture.componentInstance.gap.set(0.35);
    fixture.detectChanges();
    expect(
      marks().map((m) => m.querySelector('.ui-mark-scale__label')?.textContent),
    ).toEqual(['Бронз', 'Подстригване', 'Продукт']);
    fixture.componentInstance.gap.set(0);
    fixture.detectChanges();
    expect(marks()).toHaveLength(4);
  });
});
