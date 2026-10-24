import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  ViewEncapsulation,
  afterNextRender,
  booleanAttribute,
  computed,
  effect,
  inject,
  input,
  isDevMode,
  linkedSignal,
  signal,
} from '@angular/core';
import { UiIcon, type UiIconName, type UiIconScale } from '@creativo/ui/icons';

/**
 * ≙ `.controlSize` — picks the type roles. A local union: patterns cannot import `UiControlSize`.
 *
 * | rung         | value            | unit · delta     | caption     | glyph |
 * | ------------ | ---------------- | ---------------- | ----------- | ----- |
 * | `regular`    | title3 20/600    | subheadline 13   | caption 11  | 20    |
 * | `large`      | title 28/700     | callout 14       | footnote 12 | 24    |
 * | `extraLarge` | largeTitle 36/800 | title3 20/600   | callout 14  | 24    |
 *
 * `extraLarge` is the ONE figure a page is about («23 от 25» on a medal's
 * page): at most one per screen, never in a grid of tiles.
 */
export type UiMetricControlSize = 'regular' | 'large' | 'extraLarge';
export type UiMetricAlignment = 'leading' | 'center';
/** The direction of the last LIVE change; the sign in `uiDelta` carries it in words. */
export type UiMetricTrend = 'up' | 'down';

/** What stops a count-up and shows the final figure at once. */
const COUNT_UP_JUMPS = ['pointerdown', 'keydown', 'scroll'] as const;

/** A `Record`, so a new rung cannot be added without naming its glyph. */
const GLYPH_SCALES = {
  regular: 'medium',
  large: 'large',
  extraLarge: 'large',
} as const satisfies Record<UiMetricControlSize, UiIconScale>;

/**
 * THE METRIC — one labelled quantity read at a glance: «308 т.» over «за
 * размяна», «24» over «посещения», «4/10». A figure line (glyph · value ·
 * unit · delta, on one baseline), the visible caption under it, and an
 * accessory slot for a meter that belongs to the figure.
 *
 * The value arrives FORMATTED (`formatCents`, the locale's grouping): the
 * DS never formats a number, except the in-between frames of a count-up.
 * `null` draws «—», never a fabricated 0 — and a dash reads as "dash", so
 * the owner then names it in words (`uiLabel`; a dev warning says so).
 *
 * `uiLabel` is the accessible NAME of the group; without it the name is
 * the value, the unit and the caption joined, computed from the inputs
 * and never from painted digits, so it is final from the first frame even
 * while a count-up runs. `uiCaption` is the visible small line
 * («за размяна»); `uiCaptionHidden` keeps it in the name and off the
 * screen, where the tile around it already says it.
 *
 * The value never takes a sentiment colour — it is `currentColor`, so the
 * container decides (a paused card goes secondary). A `uiDelta` («+25»,
 * «−50») stays until the page is left, in the quiet ink; its sign says
 * which way. Motion, only after the first render: a value that rises
 * (`uiTrend="up"`) re-enters, and a new rising delta rises into place; a
 * fall swaps in place, silently, and never vanishes. `uiCountFrom` — the
 * client's own view only — counts an integer value up from that figure
 * over the deliberate beat, jumping to the end at the first touch, key or
 * scroll; reduced motion shows the figure at once.
 *
 * All spans, so it sits inside a `button[uiCard]` or a list row (a button
 * admits phrasing content only). Never interactive itself.
 */
@Component({
  selector: 'ui-metric',
  imports: [UiIcon],
  template: `
    <span class="ui-metric__figure" aria-hidden="true">
      @if (uiIcon(); as icon) {
        <ui-icon
          class="ui-metric__glyph"
          [uiName]="icon"
          [uiScale]="glyphScale()"
        />
      }
      @for (node of valueNodes(); track node.key) {
        <span
          class="ui-metric__value"
          [attr.data-enter]="node.enter ? '' : null"
        >
          <span class="ui-metric__digits">{{ painted() ?? node.key }}</span>
          @if (painted() !== null) {
            <span class="ui-metric__ghost">{{ node.key }}</span>
          }
        </span>
      }
      @if (uiUnit(); as unit) {
        <span class="ui-metric__unit">{{ unit }}</span>
      }
      @for (node of deltaNodes(); track node.key) {
        <span
          class="ui-metric__delta"
          [attr.data-trend]="uiTrend()"
          [attr.data-enter]="node.enter ? '' : null"
          >{{ node.key }}</span
        >
      }
    </span>
    @if (uiCaption(); as caption) {
      @if (!uiCaptionHidden()) {
        <span class="ui-metric__caption" aria-hidden="true">{{ caption }}</span>
      }
    }
    <span class="ui-metric__accessory"
      ><ng-content select="[uiMetricAccessory]"
    /></span>
  `,
  styleUrl: './metric.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Unscoped like every pattern: `.ui-metric__*` is the styling contract.
  encapsulation: ViewEncapsulation.None,
  host: {
    class: 'ui-metric',
    role: 'group',
    '[attr.aria-label]': 'accessibleName()',
    '[attr.data-control-size]': 'uiControlSize()',
    '[attr.data-alignment]': 'uiAlignment()',
    '[attr.data-empty]': "uiValue() === null ? '' : null",
    '[attr.data-trend]': 'uiTrend()',
    '[attr.data-settled]': "settled() ? '' : null",
  },
})
export class UiMetric {
  /** Pre-formatted: «308», «12 450», «4/10». `null` draws «—». */
  readonly uiValue = input.required<string | null>();
  /** «т.», «€» — the figure's unit, a step quieter. */
  readonly uiUnit = input<string | null>(null);
  /** The visible caption under the figure: «за размяна», «интервал». */
  readonly uiCaption = input<string | null>(null);
  /** Keeps the caption in the name and off the screen. */
  readonly uiCaptionHidden = input(false, { transform: booleanAttribute });
  /** A leading glyph on the figure line. */
  readonly uiIcon = input<UiIconName | null>(null);
  /** «+25» / «−50»: the last live change, signed; it stays until the page is left. */
  readonly uiDelta = input<string | null>(null);
  /** The direction of that change; `null` = none. */
  readonly uiTrend = input<UiMetricTrend | null>(null);
  /** The client's own view only: count an integer value up from this figure. */
  readonly uiCountFrom = input<number | null>(null);
  /** The accessible name; defaults to value + unit + caption. */
  readonly uiLabel = input<string | null>(null);
  readonly uiControlSize = input<UiMetricControlSize>('regular');
  readonly uiAlignment = input<UiMetricAlignment>('leading');

  private readonly host =
    inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;

  /** Set once the first frame is on screen: nothing animates before it. */
  protected readonly settled = signal(false);

  /** The final figure, «—» for no value — what a count-up's frames are laid over. */
  protected readonly display = computed(() => this.uiValue() ?? '—');

  /** A count-up's in-between frame, or `null` when the final figure shows. */
  protected readonly painted = signal<string | null>(null);

  /** The icon ladder's rung beside the figure; it tops out at `large` (24). */
  protected readonly glyphScale = computed(
    () => GLYPH_SCALES[this.uiControlSize()],
  );

  /** A value that changed after the first frame, on the way up. */
  private readonly valueEntering = linkedSignal<string, boolean>({
    source: this.display,
    computation: (value, previous) =>
      previous !== undefined &&
      previous.source !== value &&
      this.settled() &&
      this.uiTrend() === 'up',
  });

  /** A delta that appeared or changed after the first frame, on the way up. */
  private readonly deltaEntering = linkedSignal<string | null, boolean>({
    source: this.uiDelta,
    computation: (delta, previous) =>
      previous !== undefined &&
      delta !== null &&
      previous.source !== delta &&
      this.settled() &&
      this.uiTrend() === 'up',
  });

  /**
   * The figure keyed on its FINAL value, so a new value is a new node and
   * its enter can play on it; the delta likewise. Each reads its entering
   * flag on every pass — present or not — so the flag always knows the
   * value it had before (a delta that appears from nothing still rises).
   */
  protected readonly valueNodes = computed(() => [
    { key: this.display(), enter: this.valueEntering() },
  ]);

  protected readonly deltaNodes = computed(() => {
    const enter = this.deltaEntering();
    const delta = this.uiDelta();
    return delta ? [{ key: delta, enter }] : [];
  });

  protected readonly accessibleName = computed(() => {
    const label = this.uiLabel();
    if (label !== null) return label;
    const value = this.uiValue();
    const words =
      value === null
        ? [this.uiCaption()]
        : [value, this.uiUnit(), this.uiCaption()];
    return words.filter((word): word is string => !!word).join(' ');
  });

  private frame: number | null = null;
  private clock: Animation | null = null;
  private readonly jump = (): void => this.stopCounting();

  constructor() {
    afterNextRender(() => {
      this.settled.set(true);
      this.countUp();
    });
    inject(DestroyRef).onDestroy(() => this.stopCounting());

    if (isDevMode()) {
      let warned = false;
      effect(() => {
        if (warned || this.uiValue() !== null || this.uiLabel() !== null) {
          return;
        }
        warned = true;
        console.warn(
          '[ui-metric] a null uiValue draws «—», which a screen reader says as ' +
            '"dash": pass uiLabel with the fact in words.',
        );
      });
    }
  }

  /**
   * M18: the figure counts up from `uiCountFrom` on the platform's own
   * animation clock (WAAPI, the deliberate duration on the emphasized
   * curve, both read from the tokens), painting each frame in the page's
   * locale. Anything but an integer rising from a lower start, reduced
   * motion, or no WAAPI shows the final figure at once.
   */
  private countUp(): void {
    const from = this.uiCountFrom();
    const final = this.uiValue();
    const target = integerOf(final);
    if (from === null || target === null || !(target > from)) return;
    if (prefersReducedMotion() || typeof this.host.animate !== 'function') {
      return;
    }
    const tokens = getComputedStyle(this.host);
    const duration =
      durationOf(tokens.getPropertyValue('--sys-motion-duration-deliberate')) ??
      300;
    const easing =
      tokens.getPropertyValue('--sys-motion-ease-emphasized').trim() ||
      'ease-out';
    const format = new Intl.NumberFormat(
      document.documentElement.lang || undefined,
      { maximumFractionDigits: 0 },
    );
    const clock = this.host.animate([], { duration, easing });
    this.clock = clock;
    for (const type of COUNT_UP_JUMPS) {
      window.addEventListener(type, this.jump, {
        capture: true,
        passive: true,
      });
    }
    const paint = (): void => {
      const progress = clock.effect?.getComputedTiming().progress;
      if (
        this.clock !== clock ||
        this.uiValue() !== final ||
        progress === null ||
        progress === undefined
      ) {
        this.stopCounting();
        return;
      }
      this.painted.set(
        format.format(Math.round(from + (target - from) * progress)),
      );
      this.frame = requestAnimationFrame(paint);
    };
    this.painted.set(format.format(from));
    this.frame = requestAnimationFrame(paint);
    clock.finished.then(
      () => this.stopCounting(),
      () => this.stopCounting(),
    );
  }

  private stopCounting(): void {
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.frame = null;
    for (const type of COUNT_UP_JUMPS) {
      window.removeEventListener(type, this.jump, { capture: true });
    }
    const clock = this.clock;
    this.clock = null;
    clock?.cancel();
    if (this.painted() !== null) this.painted.set(null);
  }
}

/** A formatted whole number («308», «12 450», «12,450») as a number; anything else `null`. */
function integerOf(value: string | null): number | null {
  if (value === null) return null;
  // `\s` covers the no-break spaces the locales group with.
  const [head = '', ...groups] = value.trim().split(/[\s.,']/);
  const whole =
    groups.length === 0
      ? /^\d+$/.test(head)
      : /^\d{1,3}$/.test(head) &&
        groups.every((group) => /^\d{3}$/.test(group));
  return whole ? Number(head + groups.join('')) : null;
}

/** «300ms» / «0.3s» → milliseconds. */
function durationOf(token: string): number | null {
  const match = /^\s*([\d.]+)(ms|s)\s*$/.exec(token);
  if (!match) return null;
  const amount = Number(match[1]);
  return match[2] === 's' ? amount * 1000 : amount;
}

/** Read at call time, so a setting changed mid-session is honoured. */
function prefersReducedMotion(): boolean {
  return (
    typeof matchMedia === 'function' &&
    matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}
