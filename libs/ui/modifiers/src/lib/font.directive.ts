import { Directive, input } from '@angular/core';

export type UiFontStyle =
  | 'display'
  | 'extraLargeTitle'
  | 'largeTitle'
  | 'title'
  | 'title2'
  | 'title3'
  | 'headline'
  | 'body'
  | 'callout'
  | 'subheadline'
  | 'footnote'
  | 'caption'
  | 'eyebrow';

/**
 * ≙ SwiftUI `.font(_:)` — writes `data-font`; `[data-font="…"]` in CSS does 100% of the styling.
 *
 * @uiPurpose Sets an element's text style from the type scale (title, headline,
 *   body, caption).
 * @uiSwiftUI `.font(_:)`
 * @uiAliases font, typography, text style, font-size, type scale
 * @uiNotThis Font, weight and colour together on one element are `uiText`.
 */
@Directive({
  selector: '[uiFont]',
  host: { '[attr.data-font]': 'uiFont()' },
})
export class UiFontDirective {
  readonly uiFont = input.required<UiFontStyle>();
}
