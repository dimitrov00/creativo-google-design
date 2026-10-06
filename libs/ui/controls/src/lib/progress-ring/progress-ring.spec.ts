import { ApplicationRef, Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import * as fc from 'fast-check';
import type { MockInstance } from 'vitest';
import { UiProgressRing } from './progress-ring';

@Component({
  imports: [UiProgressRing],
  template: `<ui-progress-ring
    [uiValue]="value()"
    [uiLabel]="label()"
    [uiValueText]="valueText()"
    ><span class="center">2/3</span></ui-progress-ring
  >`,
})
class HostComponent {
  // `numberAttribute` accepts anything; strings arrive from static markup.
  readonly value = signal<unknown>(2 / 3);
  readonly label = signal<string | null>(null);
  readonly valueText = signal<string | null>(null);
}

/** Every ARIA attribute the named mode writes — none may leak when decorative. */
const NAMED_ARIA = [
  'role',
  'aria-label',
  'aria-valuemin',
  'aria-valuemax',
  'aria-valuenow',
  'aria-valuetext',
] as const;

describe('UiProgressRing', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;
  let warn: MockInstance<typeof console.warn>;

  beforeEach(async () => {
    // Silenced for every test, asserted in the ones about it.
    warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await TestBed.configureTestingModule({
      imports: [HostComponent],
    }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
  });

  afterEach(() => warn.mockRestore());

  const ring = (): HTMLElement => {
    const el = (
      fixture.nativeElement as HTMLElement
    ).querySelector<HTMLElement>('ui-progress-ring');
    if (!el) throw new Error('ui-progress-ring did not render');
    return el;
  };

  const render = (patch: {
    value?: unknown;
    label?: string | null;
    valueText?: string | null;
  }): HTMLElement => {
    if ('value' in patch) host.value.set(patch.value);
    if ('label' in patch) host.label.set(patch.label ?? null);
    if ('valueText' in patch) host.valueText.set(patch.valueText ?? null);
    fixture.detectChanges();
    return ring();
  };

  describe('decorative (no label, the default)', () => {
    it('is hidden from assistive tech and emits no role', () => {
      const el = render({});
      expect(el.classList.contains('ui-progress-ring')).toBe(true);
      expect(el.getAttribute('aria-hidden')).toBe('true');
      for (const attr of NAMED_ARIA) expect(el.hasAttribute(attr)).toBe(false);
    });

    it('still draws the arc and the projected center for the eye', () => {
      const el = render({});
      expect(el.style.getPropertyValue('--ui-progress-ring-value')).toBe(
        String(2 / 3),
      );
      expect(el.querySelector('.center')?.textContent).toBe('2/3');
    });

    it('treats a blank label as no label — a blank name names nothing', () => {
      const el = render({ label: '   ', valueText: '2 of 3' });
      expect(el.getAttribute('aria-hidden')).toBe('true');
      for (const attr of NAMED_ARIA) expect(el.hasAttribute(attr)).toBe(false);
    });
  });

  describe('named (uiLabel set)', () => {
    it('is announced as a progress bar with a 0…100 value', () => {
      const el = render({ label: 'Profile' });
      expect(el.getAttribute('role')).toBe('progressbar');
      expect(el.getAttribute('aria-label')).toBe('Profile');
      expect(el.getAttribute('aria-valuemin')).toBe('0');
      expect(el.getAttribute('aria-valuemax')).toBe('100');
      expect(el.getAttribute('aria-valuenow')).toBe('67');
      expect(el.hasAttribute('aria-hidden')).toBe(false);
      expect(el.hasAttribute('aria-valuetext')).toBe(false);
    });

    it('speaks the owner words for the value when given, trimmed', () => {
      const el = render({ label: ' Profile ', valueText: ' 2 of 3 steps ' });
      expect(el.getAttribute('aria-label')).toBe('Profile');
      expect(el.getAttribute('aria-valuetext')).toBe('2 of 3 steps');
    });

    it('omits a blank value text rather than announcing nothing', () => {
      const el = render({ label: 'Profile', valueText: '  ' });
      expect(el.hasAttribute('aria-valuetext')).toBe(false);
    });

    it('keeps the projected center out of the accessible name', () => {
      // A progressbar's children are presentational; the center is
      // visual only, and `uiValueText` is where its words belong.
      const el = render({ label: 'Profile' });
      const center = el.querySelector('.ui-progress-ring__label');
      expect(center?.getAttribute('aria-hidden')).toBe('true');
      expect(el.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    });

    it('drops every named attribute when the label is taken away', () => {
      render({ label: 'Profile', valueText: '2 of 3' });
      const el = render({ label: null });
      expect(el.getAttribute('aria-hidden')).toBe('true');
      for (const attr of NAMED_ARIA) expect(el.hasAttribute(attr)).toBe(false);
    });
  });

  describe('a value text without a label (a consumer error)', () => {
    const warnings = () =>
      warn.mock.calls.filter(([message]) =>
        String(message).startsWith('[ui-progress-ring]'),
      );

    /**
     * Outlasts the ring's own wait (stable, a task turn, stable again), so
     * whatever it was going to judge has been judged. On the APP, not the
     * fixture, so it also waits out a ring whose fixture is destroyed — and
     * every case here shares it: the first one proves it is long enough to
     * see the warning, which is what keeps the destroyed-ring case from
     * passing vacuously if the ring's wait ever grows a turn.
     */
    const settle = async (): Promise<void> => {
      const app = TestBed.inject(ApplicationRef);
      for (let turn = 0; turn < 3; turn++) {
        await app.whenStable();
        await new Promise<void>((resolve) => setTimeout(resolve));
      }
    };

    it('waits for the app to settle, then says so once in dev mode', async () => {
      const el = render({ valueText: '1 of 3 steps' });
      expect(warnings()).toHaveLength(0);
      await settle();
      expect(warnings()).toHaveLength(1);
      expect(String(warnings()[0]?.[0])).toContain('uiLabel');
      expect(el.getAttribute('aria-hidden')).toBe('true');
      for (const attr of NAMED_ARIA) expect(el.hasAttribute(attr)).toBe(false);
    });

    it('stays decorative and warns only once, however often the text changes', async () => {
      render({ valueText: '1 of 3 steps' });
      await settle();
      render({ valueText: '2 of 3 steps' });
      await settle();
      const el = render({ value: 0.9, valueText: '3 of 3 steps' });
      await settle();
      expect(el.getAttribute('aria-hidden')).toBe('true');
      expect(warnings()).toHaveLength(1);
    });

    it('treats a blank label as missing, as the named mode does', async () => {
      render({ label: '  ', valueText: '2 of 3 steps' });
      await settle();
      expect(warnings()).toHaveLength(1);
    });

    it('warns when the label is taken away and does not come back', async () => {
      render({ label: 'Profile', valueText: '2 of 3 steps' });
      await settle();
      render({ label: null });
      await settle();
      expect(warnings()).toHaveLength(1);
    });

    it('is quiet for a named ring, a plain decorative ring, and a blank text', async () => {
      render({ label: 'Profile', valueText: '2 of 3 steps' });
      render({ label: null, valueText: null });
      render({ valueText: '   ' });
      await settle();
      expect(warnings()).toHaveLength(0);
    });

    it('is quiet when the label arrives a pass after the text', async () => {
      render({ valueText: '2 of 3 steps' }); // the text's pass: no label yet
      await Promise.resolve(); // the label's async source resolves…
      render({ label: 'Profile' }); // …and the next pass names the ring
      await settle();
      expect(warnings()).toHaveLength(0);
      expect(ring().getAttribute('aria-valuetext')).toBe('2 of 3 steps');
    });

    it('is quiet when a timer delivers the label and the scheduler renders it', async () => {
      render({ valueText: '2 of 3 steps' });
      // No detectChanges: zoneless change detection picks the signal up.
      setTimeout(() => host.label.set('Profile'));
      await settle();
      expect(warnings()).toHaveLength(0);
      expect(ring().getAttribute('role')).toBe('progressbar');
    });

    it('is quiet for a ring destroyed before the app settled', async () => {
      render({ valueText: '2 of 3 steps' });
      fixture.destroy();
      await settle();
      expect(warnings()).toHaveLength(0);
    });
  });

  describe('clamping', () => {
    const cases: readonly {
      readonly name: string;
      readonly value: unknown;
      readonly fraction: number;
      readonly percent: string;
      readonly state: 'empty' | 'complete' | 'partial';
    }[] = [
      { name: 'NaN', value: NaN, fraction: 0, percent: '0', state: 'empty' },
      {
        name: 'a non-numeric string',
        value: 'abc',
        fraction: 0,
        percent: '0',
        state: 'empty',
      },
      { name: 'null', value: null, fraction: 0, percent: '0', state: 'empty' },
      {
        name: 'a negative value',
        value: -0.5,
        fraction: 0,
        percent: '0',
        state: 'empty',
      },
      {
        name: '-Infinity',
        value: -Infinity,
        fraction: 0,
        percent: '0',
        state: 'empty',
      },
      { name: 'zero', value: 0, fraction: 0, percent: '0', state: 'empty' },
      {
        name: 'a numeric string',
        value: '0.25',
        fraction: 0.25,
        percent: '25',
        state: 'partial',
      },
      {
        name: 'exactly full',
        value: 1,
        fraction: 1,
        percent: '100',
        state: 'complete',
      },
      {
        name: 'a value above 1',
        value: 1.5,
        fraction: 1,
        percent: '100',
        state: 'complete',
      },
      {
        name: 'Infinity',
        value: Infinity,
        fraction: 1,
        percent: '100',
        state: 'complete',
      },
      {
        name: 'a started sliver (never announced as 0)',
        value: 0.004,
        fraction: 0.004,
        percent: '1',
        state: 'partial',
      },
      {
        name: 'almost full (never announced as 100)',
        value: 0.996,
        fraction: 0.996,
        percent: '99',
        state: 'partial',
      },
    ];

    it.each(cases)(
      'reads $name as $fraction ($percent%, $state)',
      ({ value, fraction, percent, state }) => {
        const el = render({ value, label: 'Profile' });
        expect(
          Number(el.style.getPropertyValue('--ui-progress-ring-value')),
        ).toBe(fraction);
        expect(el.getAttribute('aria-valuenow')).toBe(percent);
        expect(el.hasAttribute('data-empty')).toBe(state === 'empty');
        expect(el.hasAttribute('data-complete')).toBe(state === 'complete');
      },
    );

    it('keeps the announced percent whole, in range and in step with the drawn state for any number', () => {
      host.label.set('Profile');
      fc.assert(
        fc.property(fc.double(), (value) => {
          const el = render({ value });
          const drawn = Number(
            el.style.getPropertyValue('--ui-progress-ring-value'),
          );
          const now = Number(el.getAttribute('aria-valuenow'));
          expect(drawn).toBeGreaterThanOrEqual(0);
          expect(drawn).toBeLessThanOrEqual(1);
          expect(Number.isInteger(now)).toBe(true);
          expect(now).toBeGreaterThanOrEqual(0);
          expect(now).toBeLessThanOrEqual(100);
          expect(now === 100).toBe(el.hasAttribute('data-complete'));
          expect(now === 0).toBe(el.hasAttribute('data-empty'));
        }),
        { numRuns: 300 },
      );
    });

    it('never announces less progress for a larger value', () => {
      host.label.set('Profile');
      const finite = fc.double({ noNaN: true, min: -2, max: 2 });
      fc.assert(
        fc.property(finite, finite, (a, b) => {
          const [low, high] = a <= b ? [a, b] : [b, a];
          const nowLow = Number(
            render({ value: low }).getAttribute('aria-valuenow'),
          );
          const nowHigh = Number(
            render({ value: high }).getAttribute('aria-valuenow'),
          );
          expect(nowLow).toBeLessThanOrEqual(nowHigh);
        }),
        { numRuns: 200 },
      );
    });
  });
});
