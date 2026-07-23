import { Directive, booleanAttribute, input } from '@angular/core';

/**
 * ≙ SwiftUI `.disabled(_:)` — writes `data-disabled` (styled in
 * modifiers.css: dimmed to `--sys-opacity-disabled`, pointer events off)
 * paired with `aria-disabled` from the same signal (§ styling-conventions:
 * data-* and aria-* pairs are driven by one source, never hand-mirrored).
 *
 * For elements with a native `disabled` attribute (button, input) keep
 * using the native attribute — controls already style `:disabled`. This
 * modifier is for non-form surfaces: inert cards, coming-soon tiles,
 * temporarily unavailable rows.
 */
@Directive({
  selector: '[uiDisabled]',
  host: {
    '[attr.data-disabled]': "uiDisabled() ? '' : null",
    '[attr.aria-disabled]': 'uiDisabled() || null',
  },
})
export class UiDisabledDirective {
  readonly uiDisabled = input(true, { transform: booleanAttribute });
}
