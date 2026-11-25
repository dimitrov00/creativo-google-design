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
 *
 * @uiPurpose Styles an anchor or button as an underlined text link inside a
 *   sentence.
 * @uiSwiftUI `Link`, or a Markdown link inside `Text`
 * @uiAliases link, anchor, hyperlink, inline link, underline
 * @uiNotThis A standalone action such as a footer link is a plain `uiButton`.
 */
@Directive({
  selector: 'a[uiLink], button[uiLink]',
  host: { 'data-link': '' },
})
export class UiLinkDirective {}
