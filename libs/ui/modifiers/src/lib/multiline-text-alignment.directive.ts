import { Directive, input } from '@angular/core';

export type UiTextAlignment = 'leading' | 'center' | 'trailing';

/**
 * ≙ SwiftUI `.multilineTextAlignment(_:)` — writes `data-text-alignment`.
 *
 * How WRAPPED LINES sit inside one text box. This is the sibling concept
 * to `ui-stack`'s `uiAlignment` (≙ `VStack(alignment:)`), not a substitute
 * for it, and the two are easy to confuse:
 *
 * - `uiAlignment` positions sibling BOXES along the stack's cross axis.
 *   A trailing stack already shrink-wraps every child to the trailing
 *   edge, so single-line content needs nothing more — reaching for text
 *   alignment there is a no-op (the services performer row shipped one
 *   such dead rule until 2026-07-28).
 * - `uiMultilineTextAlignment` only bites once a single run of text wraps
 *   onto a second line: it decides where the ragged edge falls. A centred
 *   card's two-line name is the canonical case.
 *
 * Reach for it at COMPOSITION sites (a centred card, a centred lede).
 * Components whose own recipe is inherently centred — the OTP field's
 * digit boxes, a calendar's day cells — keep `text-align` in their own
 * stylesheet: that's the recipe, not a caller's choice.
 *
 * ```html
 * <ui-stack uiAlignment="center" uiMultilineTextAlignment="center"> … </ui-stack>
 * ```
 */
@Directive({
  selector: '[uiMultilineTextAlignment]',
  host: { '[attr.data-text-alignment]': 'uiMultilineTextAlignment()' },
})
export class UiMultilineTextAlignmentDirective {
  readonly uiMultilineTextAlignment = input('leading', {
    // Bare-attribute usage (`<p uiMultilineTextAlignment>`) binds the
    // empty string — the uiOverlay precedent maps it back to the default.
    transform: (value: UiTextAlignment | ''): UiTextAlignment =>
      value === '' ? 'leading' : value,
  });
}
