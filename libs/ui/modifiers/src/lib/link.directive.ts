import { Directive } from '@angular/core';

/**
 * Inline text link — the classic underlined link INSIDE a sentence (legal
 * copy's Terms/Privacy, an inline "Edit" affordance). Writes `data-link`;
 * the one recipe lives in modifiers.css: underlined with a tasteful
 * underline offset, secondary ink at rest, primary on hover with an
 * ungated `:active` mirror (mobile press parity), shared focus ring.
 *
 * Scoped to `a`/`button` so the affordance is always a real interactive
 * element — a `button[uiLink]` is reset to read as text and stays a
 * button semantically. NOT for standalone footer actions (those are
 * `plain` uiButtons per the SwiftUI-parity ruling); uiLink is for links
 * living inside running text.
 */
@Directive({
  selector: 'a[uiLink], button[uiLink]',
  host: { 'data-link': '' },
})
export class UiLinkDirective {}
