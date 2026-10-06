import {
  ApplicationRef,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ViewEncapsulation,
  computed,
  effect,
  inject,
  input,
  isDevMode,
  numberAttribute,
  untracked,
} from '@angular/core';

/**
 * Determinate circular progress — the Apple gauge/activity-ring language
 * for "how much of a whole is done" (profile completion, an upload, a
 * multi-step setup…). A quiet track circle with an accent arc that DRAWS
 * ITSELF to the bound value on mount (stroke-dashoffset keyframe from
 * empty; value CHANGES then glide on a transition), rounded caps, starting
 * at 12 o'clock. Center content is projected — a "2/3" caption, a check
 * glyph, a percentage — the ring imposes no typography of its own. It is
 * not a meter: persistent state (loyalty points, tiers, punch cards) is
 * `ui-gauge`'s, which has no mount draw.
 *
 * Sizing rides the consumer's uiFrame (the SVG fills the host); stroke
 * scales with the viewBox so every size keeps the same ring weight.
 *
 * **Accessibility — two modes, one switch (`uiLabel`).**
 * - *Named* (`uiLabel` set): announced as what it is, a determinate
 *   progress bar (≙ SwiftUI `ProgressView(value:)` with a label, the same
 *   role `ui-progress-view` takes) — `role="progressbar"`, `aria-label`,
 *   `aria-valuemin="0"`, `aria-valuemax="100"`, `aria-valuenow` = the
 *   rounded percent (never 100 before full, never 0 once started), and
 *   `aria-valuetext` from `uiValueText` when the percent alone is not the
 *   whole story («2 от 3 стъпки»). A progressbar's children are
 *   presentational, so the projected center is visual only: whatever it
 *   says that the reader must hear goes in `uiValueText`.
 * - *Decorative* (the default): `aria-hidden="true"` and no role — for a
 *   ring whose progress is already said in words beside it. An unnamed
 *   role is never emitted (an unnamed `role="img"` or `progressbar` fails
 *   WCAG 1.1.1, axe `role-img-alt` / `aria-progressbar-name`).
 * A blank label counts as none, since it would name nothing. A value text
 * without a label is a consumer error — there is no progressbar to carry
 * it — so the ring stays decorative and, in dev mode, warns once: judged
 * after the app has settled, so a label that arrives a pass after the text
 * is not one.
 *
 * Both strings are the consumer's words, so they come from its i18n
 * catalogue (bg and en in parity), never concatenated in the template.
 *
 * ```html
 * <!-- Decorative: the line beside it says «2 от 3 готови». -->
 * <ui-progress-ring [uiValue]="2 / 3" uiFrame uiFrameWidth="4rem">
 *   <span uiText uiFont="footnote" uiWeight="semibold">2/3</span>
 * </ui-progress-ring>
 *
 * <!-- Named: the ring alone carries the progress. -->
 * <ng-container *transloco="let t">
 *   <ui-progress-ring
 *     [uiValue]="done / total"
 *     [uiLabel]="t('setup.progress.label')"
 *     [uiValueText]="t('setup.progress.steps', { done, total })"
 *   />
 * </ng-container>
 * ```
 */
@Component({
  selector: 'ui-progress-ring',
  template: `
    <svg viewBox="0 0 48 48" aria-hidden="true">
      <circle
        class="ui-progress-ring__track"
        cx="24"
        cy="24"
        r="21"
        pathLength="1"
      />
      <circle
        class="ui-progress-ring__value"
        cx="24"
        cy="24"
        r="21"
        pathLength="1"
      />
    </svg>
    <span class="ui-progress-ring__label" aria-hidden="true">
      <ng-content />
    </span>
  `,
  styleUrl: './progress-ring.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Unscoped: bare `.ui-*`/`[data-*]` selectors never match a component's
  // own HOST element under emulated encapsulation (see avatar.ts) — and
  // global `.ui-*` classes are this system's actual styling contract (§3.1).
  encapsulation: ViewEncapsulation.None,
  host: {
    class: 'ui-progress-ring',
    '[attr.role]': "label() ? 'progressbar' : null",
    '[attr.aria-hidden]': "label() ? null : 'true'",
    '[attr.aria-label]': 'label()',
    '[attr.aria-valuemin]': 'label() ? 0 : null',
    '[attr.aria-valuemax]': 'label() ? 100 : null',
    '[attr.aria-valuenow]': 'label() ? percent() : null',
    '[attr.aria-valuetext]': 'label() ? valueText() : null',
    '[style.--ui-progress-ring-value]': 'clamped()',
    '[attr.data-complete]': "clamped() >= 1 ? '' : null",
    '[attr.data-empty]': "clamped() === 0 ? '' : null",
  },
})
export class UiProgressRing {
  /** Fraction complete, 0…1 (clamped; not a number reads as 0). */
  readonly uiValue = input.required({ transform: numberAttribute });
  /**
   * The accessible name. Set it only when the ring carries the progress
   * alone; without it the ring is decorative and hidden from readers.
   */
  readonly uiLabel = input<string | null>(null);
  /**
   * What a reader hears for the value, in the owner's words («2 от 3
   * стъпки»). Only read in the named mode (with `uiLabel`); without a label
   * it is dropped, and dev mode warns.
   */
  readonly uiValueText = input<string | null>(null);

  protected readonly clamped = computed(() => {
    const value = this.uiValue();
    if (Number.isNaN(value)) return 0;
    return Math.min(1, Math.max(0, value));
  });

  /**
   * Whole percent for `aria-valuenow`, rounded — except that rounding never
   * says «100» before the ring is full or «0» once it has started (99.6 %
   * reads 99, 0.4 % reads 1), so the number a reader hears always agrees
   * with `data-complete` / `data-empty`, the states the eye sees.
   */
  protected readonly percent = computed(() => {
    const fraction = this.clamped();
    if (fraction === 0) return 0;
    if (fraction === 1) return 100;
    return Math.min(99, Math.max(1, Math.round(fraction * 100)));
  });

  protected readonly label = computed(() => blankToNull(this.uiLabel()));

  protected readonly valueText = computed(() =>
    blankToNull(this.uiValueText()),
  );

  /** A value text handed to a ring that has no label to announce it with. */
  private readonly unnamedWithText = computed(
    () => this.label() === null && this.valueText() !== null,
  );

  constructor() {
    // Words handed to a ring that will never say them: a value text needs
    // the progressbar only a label creates. Judged once the app has SETTLED,
    // not on the first pass that sees the text — a label bound from a later
    // pass (an async source, a signal set after the text) must not trip it.
    // Once per ring: after the warning the effect reads nothing, so it never
    // runs again.
    if (isDevMode()) {
      const app = inject(ApplicationRef);
      let destroyed = false;
      inject(DestroyRef).onDestroy(() => (destroyed = true));
      let warned = false;
      let judging = false;
      effect(() => {
        if (warned) return;
        // Read before any early return, so the effect keeps tracking it.
        if (!this.unnamedWithText() || judging) return;
        judging = true;
        void settled(app).then(() => {
          judging = false;
          if (destroyed || warned || !untracked(this.unnamedWithText)) return;
          warned = true;
          console.warn(
            '[ui-progress-ring] uiValueText is only announced with a uiLabel; ' +
              'without one the ring stays decorative and drops the value text.',
          );
        });
      });
    }
  }
}

/**
 * Resolves once the app has settled: no change detection scheduled and no
 * tracked async work pending (HttpClient, resources, PendingTasks), then
 * the same again after one more task turn — so a value that lands in a
 * microtask or a zero-delay timeout, and the pass that renders it, are in
 * before anything is judged.
 */
async function settled(app: ApplicationRef): Promise<void> {
  await app.whenStable();
  await new Promise<void>((resolve) => setTimeout(resolve));
  await app.whenStable();
}

function blankToNull(text: string | null): string | null {
  const trimmed = text?.trim();
  return trimmed ? trimmed : null;
}
