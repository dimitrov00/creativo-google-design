import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  ViewEncapsulation,
  contentChildren,
  effect,
  forwardRef,
  inject,
  input,
  isDevMode,
} from '@angular/core';
import { UiIcon, type UiIconName } from '@creativo/ui/icons';

/**
 * How loud one verb of the run is.
 *
 * - `'standard'`: a tinted disc, the accent wash with the glyph in the one
 *   orange.
 * - `'accent'`: THE promoted verb of the run (the one a barber reaches for
 *   first: «Повтори», «Използвай»), a SOLID accent disc with a white
 *   glyph. One per run, never two.
 */
export type UiQuickActionProminence = 'standard' | 'accent';

/**
 * THE QUICK ACTIONS: a run of round discs under an identity, each a glyph
 * on its disc with its word under it, as Apple Contacts, Revolut and the
 * Maps place card draw them. The verbs a person reaches for first, where
 * the thumb already is.
 *
 * The run is a row of equal columns at one PITCH (88), centred in the
 * column: three verbs sit in the middle of the page, they do not stretch
 * across it. Where the page is narrower than the run, every column gives
 * up the same share (73 for four verbs on a 330 pt phone) and the discs
 * keep their size.
 *
 * `uiColumns` is the number of verbs PRESENT (the consumer passes its own
 * count): a verb this person cannot use is ABSENT, never dimmed, and the
 * run closes up round it, so there is never a hole where a verb used to
 * be. `uiLabel` names the group for a reader («Връзка»); each verb is a
 * native link or button and names itself: its accessible name begins with
 * the word under its disc (WCAG 2.5.3).
 *
 * Colour is a shape here, never a word: the caption is always the primary
 * ink. Every disc wears the accent wash, and ONE verb of a run may be
 * promoted to the solid disc (`uiProminence="accent"`). No busy state and
 * no destructive verb: every disc is an OS hand-off, a navigation or a
 * synchronous act, and anything asynchronous belongs in a dock that can
 * say it is working.
 *
 *   <ui-quick-actions uiLabel="Връзка" [uiColumns]="4">
 *     <a uiQuickAction uiIcon="contact.phone" href="tel:…">Обади се</a>
 *     <button uiQuickAction uiIcon="visit.repeat" uiProminence="accent">
 *       Повтори
 *     </button>
 *   </ui-quick-actions>
 *
 * Custom properties (set on the run, or on anything round it):
 * `--ui-quick-actions-columns` (stamped from `uiColumns`),
 * `--ui-quick-actions-pitch` (88), `--ui-quick-action-disc` (52),
 * `--ui-quick-action-fill` and `--ui-quick-action-ink` (the standard
 * disc's fill and its glyph's ink: the accent wash, the accent),
 * `--ui-quick-action-promoted-fill` and `--ui-quick-action-promoted-ink`
 * (the promoted disc's: the accent, white). They paint a disc and the
 * mark on it, never a word.
 *
 * The NEUTRAL fill is those properties away, for a run that must stay
 * quiet beside something louder:
 *
 *   .quiet-run {
 *     --ui-quick-action-fill: var(--sys-color-fill);
 *     --ui-quick-action-ink: var(--sys-color-foreground);
 *   }
 */
@Component({
  selector: 'ui-quick-actions',
  template: '<ng-content />',
  styleUrl: './quick-actions.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Unscoped like every pattern: `.ui-quick-action*` is the styling contract.
  encapsulation: ViewEncapsulation.None,
  host: {
    class: 'ui-quick-actions',
    role: 'group',
    '[attr.aria-label]': 'uiLabel()',
    '[style.--ui-quick-actions-columns]': 'uiColumns()',
  },
})
export class UiQuickActions {
  /** The group's accessible name: «Връзка». */
  readonly uiLabel = input.required<string>();
  /** How many verbs are present: one equal column each. */
  readonly uiColumns = input(4);

  /** The verbs of this run, as they come and go. */
  private readonly actions = contentChildren(forwardRef(() => UiQuickAction));

  constructor() {
    if (isDevMode()) {
      let warned = false;
      effect(() => {
        const promoted = this.actions().filter(
          (action) => action.uiProminence() === 'accent',
        ).length;
        if (warned || promoted <= 1) return;
        warned = true;
        console.warn(
          `[ui-quick-actions] ${promoted} verbs are uiProminence="accent": ` +
            'a run promotes ONE verb, or none.',
        );
      });
    }
  }
}

/**
 * One verb of a `ui-quick-actions` run: the glyph (24, the `large` rung)
 * on its disc (52), its word under it on ONE line. On an anchor it hands
 * off (a `tel:`, a route); on a button it acts (`type="button"` is
 * stamped, so it never submits a form it happens to sit in).
 *
 * The whole column is the target; the DISC answers. The hover and press
 * layer, the press scale and the focus ring are drawn on the disc, so
 * nothing lights up round a word and no state ever leaves the column.
 *
 * A count that belongs to the verb (two tickets behind «Използвай») is a
 * badge PROJECTED onto the disc's corner, and it is said in the verb's
 * accessible name, which the consumer writes:
 *
 *   <button uiQuickAction uiIcon="promo.coupon" uiProminence="accent"
 *           aria-label="Използвай: 2 награди">
 *     Използвай
 *     <span uiQuickActionBadge uiBadge uiProminence="increased">2</span>
 *   </button>
 */
@Component({
  selector: 'a[uiQuickAction], button[uiQuickAction]',
  imports: [UiIcon],
  template: `
    <span class="ui-quick-action__disc"
      ><ui-icon
        class="ui-quick-action__glyph"
        [uiName]="uiIcon()"
        uiScale="large" /><span class="ui-quick-action__badge"
        ><ng-content select="[uiQuickActionBadge]" /></span
    ></span>
    <span class="ui-quick-action__label"><ng-content /></span>
  `,
  // The run's sheet, so a verb is dressed wherever it is created (the
  // renderer adds one copy of a shared sheet, however many hosts ask).
  styleUrl: './quick-actions.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  host: {
    class: 'ui-quick-action',
    '[attr.data-prominence]': 'uiProminence()',
    '[attr.type]': "isButton ? 'button' : null",
  },
})
export class UiQuickAction {
  /** The verb's glyph, by its registry key. */
  readonly uiIcon = input.required<UiIconName>();
  /** `'accent'` promotes this verb: one per run. */
  readonly uiProminence = input<UiQuickActionProminence>('standard');

  protected readonly isButton =
    inject<ElementRef<HTMLElement>>(ElementRef).nativeElement.tagName ===
    'BUTTON';
}
