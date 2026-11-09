import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { UiSparkBars } from './spark-bars';

const WEEK = [3, 5, 0, 8, 2, 8, 4] as const;
const WEEK_TEXT = ['3 €', '5 €', '0 €', '8 €', '2 €', '8 €', '4 €'];

@Component({
  imports: [UiSparkBars],
  template: `
    <ui-spark-bars
      [uiValues]="values()"
      [uiHighlight]="highlight()"
      [uiAverage]="average()"
      [uiValueText]="valueText()"
      [uiLabels]="labels()"
      [uiTracks]="tracks()"
      [uiAxis]="axis()"
      uiLabel="Похарчено тази седмица: най-много в четвъртък и събота"
      data-testid="spark"
    />
  `,
})
class Host {
  readonly values = signal<readonly number[]>(WEEK);
  readonly highlight = signal<number | null>(null);
  readonly average = signal<number | null>(null);
  readonly valueText = signal<readonly string[]>(WEEK_TEXT);
  readonly labels = signal<readonly string[]>([]);
  readonly tracks = signal<readonly number[]>([]);
  readonly axis = signal(false);
}

function render(setup?: (host: Host) => void) {
  TestBed.configureTestingModule({
    imports: [Host],
    errorOnUnknownElements: true,
    errorOnUnknownProperties: true,
  });
  const fixture = TestBed.createComponent(Host);
  setup?.(fixture.componentInstance);
  fixture.detectChanges();
  const spark = fixture.nativeElement.querySelector(
    '[data-testid="spark"]',
  ) as HTMLElement;
  const one = (selector: string) => spark.querySelector(selector);
  const all = (selector: string) =>
    Array.from(spark.querySelectorAll(selector));
  const boxes = () =>
    all('.ui-spark-bars__bars:not([data-leave]) .ui-spark-bars__bar').map(
      (bar) =>
        ['x', 'y', 'width', 'height', 'rx', 'ry']
          .map((name) => bar.getAttribute(name))
          .join(' '),
    );
  return { fixture, host: fixture.componentInstance, spark, one, all, boxes };
}

describe('UiSparkBars', () => {
  it('is a named image over the measured width × 48, with a hidden table of every bar', () => {
    const { one, all } = render();
    const svg = one('svg');
    expect(svg?.getAttribute('role')).toBe('img');
    expect(svg?.getAttribute('aria-label')).toBe(
      'Похарчено тази седмица: най-много в четвъртък и събота',
    );
    expect(svg?.getAttribute('viewBox')).toBe('0 0 160 48');
    const table = one('table');
    // The recipe sits on a wrapper: a table would stretch past its 1px.
    expect(table?.hasAttribute('data-visually-hidden')).toBe(false);
    expect(table?.parentElement?.hasAttribute('data-visually-hidden')).toBe(
      true,
    );
    expect(table?.querySelector('caption')?.textContent?.trim()).toBe(
      'Похарчено тази седмица: най-много в четвъртък и събота',
    );
    // No words given: the bars are numbered.
    expect(all('tbody th').map((th) => th.textContent)).toEqual([
      '1',
      '2',
      '3',
      '4',
      '5',
      '6',
      '7',
    ]);
    expect(all('tbody td').map((td) => td.textContent)).toEqual(WEEK_TEXT);
    // No words on the drawing itself.
    expect(all('svg text')).toEqual([]);
  });

  it('draws one bar per value on the bottom, a zero as a 2 px stub', () => {
    const { boxes } = render();
    // 160 ÷ 7 a slot, 8 px bars; 8 is the top, 48 px tall.
    expect(boxes()).toEqual([
      '5.14 30 12.57 18 6 6',
      '28 18 12.57 30 6 6',
      '50.86 46 12.57 2 6 1',
      '73.71 0 12.57 48 6 6',
      '96.57 36 12.57 12 6 6',
      '119.43 0 12.57 48 6 6',
      '142.29 24 12.57 24 6 6',
    ]);
  });

  it('names its bars by uiLabels in the hidden table when given', () => {
    const { all } = render((h) =>
      h.labels.set(['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'нд']),
    );
    expect(all('tbody th').map((th) => th.textContent)).toEqual([
      'пн',
      'вт',
      'ср',
      'чт',
      'пт',
      'сб',
      'нд',
    ]);
  });

  it('keeps one bar in the paint and quiets the rest only when a highlight names a bar', () => {
    const { spark, all, host, fixture } = render();
    expect(spark.hasAttribute('data-highlighting')).toBe(false);
    host.highlight.set(3);
    fixture.detectChanges();
    expect(spark.hasAttribute('data-highlighting')).toBe(true);
    expect(
      all('.ui-spark-bars__bar').map((bar) =>
        bar.hasAttribute('data-highlight'),
      ),
    ).toEqual([false, false, false, true, false, false, false]);
    // An index past the bars is no highlight at all.
    host.highlight.set(7);
    fixture.detectChanges();
    expect(spark.hasAttribute('data-highlighting')).toBe(false);
    expect(all('[data-highlight]')).toEqual([]);
  });

  it('rules the average dashed in the comparison hook, and makes room for one above the bars', () => {
    const { one, host, fixture, boxes } = render((h) => h.average.set(5));
    const average = one('.ui-spark-bars__average');
    expect(average?.getAttribute('data-part')).toBe('comparison');
    expect(average?.getAttribute('x1')).toBe('0');
    expect(average?.getAttribute('x2')).toBe('160');
    // 5 of 8 is 30 px up from the bottom.
    expect(average?.getAttribute('y1')).toBe('18');
    expect(average?.getAttribute('y2')).toBe('18');
    // An average over every value becomes the top: 3 of 10 is 14.4 px.
    host.average.set(10);
    fixture.detectChanges();
    expect(one('.ui-spark-bars__average')?.getAttribute('y1')).toBe('0');
    expect(boxes()[0]).toBe('5.14 33.6 12.57 14.4 6 6');
    host.average.set(null);
    fixture.detectChanges();
    expect(one('.ui-spark-bars__average')).toBeNull();
  });

  it('clamps a negative value to the stub and draws stubs alone for an all-zero run', () => {
    const { boxes } = render((h) => h.values.set([0, -3, 0]));
    // 160 ÷ 3 a slot: the bar capped at 8, centred.
    expect(boxes()).toEqual([
      '14.67 46 24 2 6 1',
      '68 46 24 2 6 1',
      '121.33 46 24 2 6 1',
    ]);
  });

  it('cross-fades new values after the first frame, redraws a moved highlight in place, and drops the old bars when their fade ends', async () => {
    const { all, host, fixture, spark } = render();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(spark.hasAttribute('data-settled')).toBe(true);
    host.highlight.set(1);
    fixture.detectChanges();
    expect(all('.ui-spark-bars__bars')).toHaveLength(1);
    host.values.set([4, 4, 4, 4, 4, 4, 4]);
    fixture.detectChanges();
    const groups = all('.ui-spark-bars__bars');
    expect(groups).toHaveLength(2);
    expect(groups[0]?.hasAttribute('data-leave')).toBe(true);
    expect(groups[1]?.hasAttribute('data-enter')).toBe(true);
    groups[0]?.dispatchEvent(new Event('animationend', { bubbles: true }));
    fixture.detectChanges();
    expect(all('.ui-spark-bars__bars')).toHaveLength(1);
    expect(all('.ui-spark-bars__bars')[0]?.hasAttribute('data-leave')).toBe(
      false,
    );
  });

  it('draws nothing but the box for no values', () => {
    const { all, one } = render((h) => {
      h.values.set([]);
      h.valueText.set([]);
    });
    expect(all('.ui-spark-bars__bar')).toEqual([]);
    expect(one('table')).toBeNull();
  });
  it('draws each bar’s whole as a track behind it, and the words under the bars when asked', () => {
    const { all } = render((h) => {
      h.values.set([2, 5, 0]);
      h.tracks.set([4, 8, 0]);
      h.labels.set(['пн', 'вт', 'ср']);
      h.axis.set(true);
    });
    const tracks = all('.ui-spark-bars__track');
    // A track per bar with a whole; a day with none draws no track.
    expect(tracks).toHaveLength(2);
    // The tracks share the bars' scale: the 8 track is the full plot (the
    // drawing's 48 less the words' 18 band), the 4 track half of it.
    expect(tracks.map((t) => t.getAttribute('height'))).toEqual(['15', '30']);
    expect(
      all('.ui-spark-bars__word').map((w) => w.textContent?.trim()),
    ).toEqual(['пн', 'вт', 'ср']);
  });

  it('prints no words and no tracks unless asked', () => {
    const { all } = render((h) => h.labels.set(['пн']));
    expect(all('.ui-spark-bars__word')).toHaveLength(0);
    expect(all('.ui-spark-bars__track')).toHaveLength(0);
  });
});
