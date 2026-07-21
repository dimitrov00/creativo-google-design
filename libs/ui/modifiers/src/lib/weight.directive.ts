import { Directive, input } from '@angular/core';

export type UiFontWeight = 'regular' | 'medium' | 'semibold' | 'bold';

/**
 * ≙ SwiftUI `.fontWeight(_:)` — writes `data-weight`. Optional: every
 * `--sys-font-*` role already bakes in a weight via the `font` shorthand
 * (§3), so this is an override for when a caller wants to deviate from a
 * role's own weight, not a value every `uiFont`/`uiText` usage must repeat.
 * Unset omits the attribute entirely, leaving the role's baked-in weight.
 */
@Directive({
  selector: '[uiWeight]',
  host: { '[attr.data-weight]': 'uiWeight() ?? null' },
})
export class UiWeightDirective {
  readonly uiWeight = input<UiFontWeight | undefined>(undefined);
}
