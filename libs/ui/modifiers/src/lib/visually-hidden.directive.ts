import { Directive } from '@angular/core';

/**
 * ≙ SwiftUI `.accessibilityLabel` on an otherwise hidden `Text` — writes
 * `data-visually-hidden`. The screen-reader-only clip recipe lives once in
 * modifiers.css: the element stays in the accessibility tree (section
 * headings, SR-only hints) while rendering as a 1px clipped box. Replaces
 * per-section `.cr-visually-hidden` utilities.
 *
 * @uiPurpose Hides an element from sight while screen readers still read it.
 * @uiSwiftUI none
 * @uiAliases sr-only, screen reader only, visually hidden, a11y, accessibility
 */
@Directive({
  selector: '[uiVisuallyHidden]',
  host: { 'data-visually-hidden': '' },
})
export class UiVisuallyHiddenDirective {}
