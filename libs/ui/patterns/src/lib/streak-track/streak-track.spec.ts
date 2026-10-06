import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  UiStreakTrack,
  type UiStreakPeriod,
  type UiStreakTrackControlSize,
} from './streak-track';

const css = readFileSync(resolve(__dirname, 'streak-track.css'), 'utf8');

const period = (
  id: string,
  mark: UiStreakPeriod['mark'],
  caption = id,
): UiStreakPeriod => ({
  id,
  mark,
  caption,
  description: `${id} · ${mark}`,
});

const RUN: readonly UiStreakPeriod[] = [
  period('май', 'kept'),
  period('юни', 'kept'),
  period('юли', 'protected'),
  period('авг', 'kept'),
  period('сеп', 'kept'),
  period('окт', 'current', 'до 26.10'),
];

@Component({
  imports: [UiStreakTrack],
  template: `
    <ui-streak-track
      [uiPeriods]="periods()"
      [uiCount]="24"
      [uiCountUnit]="unit()"
      [uiCountWord]="word()"
      uiCountLabel="в ритъм"
      uiLabel="24 посещения в ритъм, следващото до 26 октомври"
      uiProtectedIcon="loyalty.freeze"
      [uiFrozen]="frozen()"
      [uiControlSize]="size()"
      data-testid="track"
    />
  `,
})
class Host {
  readonly periods = signal<readonly UiStreakPeriod[]>(RUN);
  readonly frozen = signal(false);
  readonly size = signal<UiStreakTrackControlSize>('regular');
  readonly unit = signal<string | null>('посещения');
  readonly word = signal<string | null>(null);
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
  const track = fixture.nativeElement.querySelector(
    '[data-testid="track"]',
  ) as HTMLElement;
  const periods = () => [
    ...track.querySelectorAll<HTMLElement>('.ui-streak-track__period'),
  ];
  return { fixture, host: fixture.componentInstance, track, periods };
}

afterEach(() => vi.restoreAllMocks());

describe('UiStreakTrack', () => {
  it('is one image with one sentence, and a hidden list of the periods beside it — outside the image', () => {
    const { track } = render();
    const figure = track.querySelector(
      '.ui-streak-track__figure',
    ) as HTMLElement;
    expect(figure.getAttribute('role')).toBe('img');
    expect(figure.getAttribute('aria-label')).toBe(
      '24 посещения в ритъм, следващото до 26 октомври',
    );
    const list = track.querySelector('.ui-streak-track__list') as HTMLElement;
    expect(list.getAttribute('role')).toBe('list');
    expect(list.hasAttribute('data-visually-hidden')).toBe(true);
    expect(figure.contains(list)).toBe(false);
    const items = [...list.children] as HTMLElement[];
    expect(items.map((item) => item.getAttribute('role'))).toEqual(
      RUN.map(() => 'listitem'),
    );
    expect(items.map((item) => item.textContent)).toEqual(
      RUN.map((p) => p.description),
    );
    // Not focusable: it is read, not operated.
    expect(track.querySelector('[tabindex], button, a')).toBeNull();
  });

  it('is phrasing content throughout, so it may sit inside button[uiCard] (the glance tile)', () => {
    // `ui-metric` is all spans by its own contract (metric.spec.ts).
    for (const size of ['regular', 'small'] as const) {
      TestBed.resetTestingModule();
      const { track } = render((h) => {
        h.frozen.set(true);
        h.size.set(size);
      });
      const SVG = 'http://www.w3.org/2000/svg';
      const flow = [...track.querySelectorAll('*')].filter(
        (el) =>
          el.namespaceURI !== SVG &&
          !['SPAN', 'UI-ICON', 'UI-METRIC'].includes(el.tagName),
      );
      expect([size, flow.map((el) => el.tagName)]).toEqual([size, []]);
      expect(track.querySelector('ul, ol, li')).toBeNull();
    }
  });

  it('draws the count as a regular ui-metric at both sizes — the figure over what it counts — inside the one image', () => {
    // Wave D r5: `regular` built its own one-line figure (title2 · callout ·
    // caption) beside the small size's metric — two recipes in one part.
    for (const size of ['regular', 'small'] as const) {
      TestBed.resetTestingModule();
      const { track } = render((h) => h.size.set(size));
      const metrics = track.querySelectorAll('ui-metric');
      expect([size, metrics.length]).toEqual([size, 1]);
      const metric = metrics[0] as HTMLElement;
      expect([size, metric.getAttribute('data-control-size')]).toEqual([
        size,
        'regular',
      ]);
      expect(metric.querySelector('.ui-metric__digits')?.textContent).toBe(
        '24',
      );
      expect(metric.querySelector('.ui-metric__unit')?.textContent).toBe(
        'посещения',
      );
      expect(metric.querySelector('.ui-metric__caption')?.textContent).toBe(
        'в ритъм',
      );
      // Inside the image, whose one sentence speaks for it.
      expect(metric.closest('[role="img"]')?.getAttribute('aria-label')).toBe(
        '24 посещения в ритъм, следващото до 26 октомври',
      );
      // The track never restates the metric's recipe.
      expect(track.querySelector('.ui-streak-track__count')).toBeNull();
    }
    expect(css).not.toMatch(
      /\.ui-streak-track__(count|value|unit|count-label)\b/,
    );
    expect(css).not.toMatch(/--sys-font-(title2|callout)/);
    expect(css).not.toMatch(/\.ui-metric/);
  });

  it('puts a word in the place of the figure when the owner prints the count elsewhere — the one sentence unchanged', () => {
    // Wave D r6: a run unbroken since the first visit IS the visit count
    // the glance's heading prints — «Винаги / в ритъм», not «24» twice.
    const { track } = render((h) => {
      h.word.set('Винаги');
      h.unit.set(null);
    });
    const metric = track.querySelector('ui-metric') as HTMLElement;
    expect(metric.querySelector('.ui-metric__digits')?.textContent).toBe(
      'Винаги',
    );
    expect(metric.querySelector('.ui-metric__unit')).toBeNull();
    expect(metric.querySelector('.ui-metric__caption')?.textContent).toBe(
      'в ритъм',
    );
    expect(
      track.querySelector('[role="img"]')?.getAttribute('aria-label'),
    ).toBe('24 посещения в ритъм, следващото до 26 октомври');
  });

  it('marks every period by its kind, captions each at the regular size, and the open one with its date', () => {
    const { periods } = render();
    expect(periods().map((p) => p.dataset['mark'])).toEqual([
      'kept',
      'kept',
      'protected',
      'kept',
      'kept',
      'current',
    ]);
    expect(
      periods().map(
        (p) => p.querySelector('.ui-streak-track__caption')?.textContent,
      ),
    ).toEqual(['май', 'юни', 'юли', 'авг', 'сеп', 'до 26.10']);
  });

  it('joins a kept run in the tint, runs quiet through a protected period and dotted into the open one', () => {
    const { periods } = render();
    expect(periods().map((p) => p.dataset['connector'] ?? null)).toEqual([
      null,
      'tint',
      'quiet',
      'quiet',
      'tint',
      'dotted',
    ]);
  });

  it('breaks the run at a miss: no connector either side', () => {
    const { periods } = render((h) =>
      h.periods.set([
        period('a', 'kept'),
        period('b', 'kept'),
        period('c', 'missed'),
        period('d', 'repaired'),
        period('e', 'current'),
      ]),
    );
    expect(periods().map((p) => p.dataset['connector'] ?? null)).toEqual([
      null,
      'tint',
      null,
      null,
      'dotted',
    ]);
  });

  it('shows the freeze glyph in a protected period — and, frozen, in the open one too', () => {
    const { periods, fixture, host, track } = render();
    const glyphs = () =>
      periods().map((p) => !!p.querySelector('ui-icon.ui-streak-track__glyph'));
    expect(glyphs()).toEqual([false, false, true, false, false, false]);
    expect(
      periods()[2]?.querySelector('ui-icon')?.getAttribute('data-name'),
    ).toBe('loyalty.freeze');
    host.frozen.set(true);
    fixture.detectChanges();
    expect(track.hasAttribute('data-frozen')).toBe(true);
    expect(glyphs()).toEqual([false, false, true, false, false, true]);
  });

  it('drops the captions at the small size', () => {
    const { track, periods } = render((h) => h.size.set('small'));
    expect(track.dataset['controlSize']).toBe('small');
    expect(periods()).toHaveLength(6);
    expect(track.querySelector('.ui-streak-track__caption')).toBeNull();
  });

  it('draws at most the newest twelve periods, and says so in development', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const many = Array.from({ length: 14 }, (_, i) => period(`p${i}`, 'kept'));
    const { periods, track } = render((h) => h.periods.set(many));
    expect(periods()).toHaveLength(12);
    expect(
      periods()[0]?.querySelector('.ui-streak-track__caption')?.textContent,
    ).toBe('p2');
    expect(track.querySelectorAll('[role="listitem"]')).toHaveLength(12);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('draws in only the connector of an open period that a live change kept', () => {
    const { periods, fixture, host } = render();
    expect(periods().some((p) => p.hasAttribute('data-extended'))).toBe(false);
    host.periods.set([
      ...RUN.slice(1, 5),
      period('окт', 'kept'),
      period('ное', 'current', 'до 23.11'),
    ]);
    fixture.detectChanges();
    expect(
      periods()
        .filter((p) => p.hasAttribute('data-extended'))
        .map((p) => p.querySelector('.ui-streak-track__caption')?.textContent),
    ).toEqual(['окт']);
  });

  it('sets the first and last marks on the content edges, spread over the periods it publishes', () => {
    // As one equal column each, the first mark sat 13 pt inside the figure
    // above it, and the inset hung on the count (gauge.css's step grammar).
    const { track, fixture, host } = render();
    expect(track.style.getPropertyValue('--ui-streak-periods')).toBe('6');
    host.periods.set(RUN.slice(0, 4));
    fixture.detectChanges();
    expect(track.style.getPropertyValue('--ui-streak-periods')).toBe('4');
    const flat = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ');
    const body = (selector: string) => {
      const at = flat.indexOf(`${selector} {`);
      if (at < 0) throw new Error(`streak-track.css has no "${selector}" rule`);
      return flat.slice(at, flat.indexOf('}', at));
    };
    const row = body('.ui-streak-track__periods');
    expect(row).toContain('container-type: inline-size;');
    expect(row).toContain('justify-content: space-between;');
    expect(row).toContain(
      '--ui-streak-pitch: calc( (100cqi - var(--ui-streak-mark)) / max(var(--ui-streak-periods, 1) - 1, 1) );',
    );
    expect(body('.ui-streak-track__period')).toContain(
      'inline-size: var(--ui-streak-mark);',
    );
    expect(body('.ui-streak-track__period:first-child')).toContain(
      'align-items: flex-start;',
    );
    expect(body('.ui-streak-track__period:last-child')).toContain(
      'align-items: flex-end;',
    );
    expect(body('.ui-streak-track__caption')).toContain(
      'max-inline-size: var(--ui-streak-words, var(--ui-streak-pitch));',
    );
    // The mark is a unit multiple, never a literal.
    expect(body('.ui-streak-track')).toContain(
      '--ui-streak-mark: calc(var(--sys-space-unit) * 6);',
    );
  });

  it('tints with the accent, the secondary ink when frozen, and never paints a miss red', () => {
    const root = /\.ui-streak-track\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(root).toContain('--ui-streak-tint: var(--sys-color-accent);');
    const frozen =
      /\.ui-streak-track\[data-frozen\]\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(frozen).toContain(
      '--ui-streak-tint: var(--sys-color-secondary-label);',
    );
    expect(css).not.toMatch(/destructive/);
    const missed =
      /\[data-mark='missed'\] \.ui-streak-track__mark\s*\{([^}]*)\}/.exec(
        css,
      )?.[1] ?? '';
    expect(missed).toContain('dashed');
  });
});
