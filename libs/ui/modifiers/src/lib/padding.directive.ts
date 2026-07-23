import { Directive, input } from '@angular/core';

export type UiPaddingScale =
  | 'none'
  | 'tight'
  | 'compact'
  | 'regular'
  | 'comfortable'
  | 'loose'
  | 'spacious';

/** Bare-attribute usage (`<div uiPadding>`) binds the empty string. */
const bareToRegular = (
  value: UiPaddingScale | '' | undefined,
): UiPaddingScale | undefined => (value === '' ? 'regular' : value);

/**
 * ≙ SwiftUI `.padding(_:)` / `.padding(.horizontal, _:)` /
 * `.padding(.vertical, _:)` — writes `data-padding` /
 * `data-padding-horizontal` / `data-padding-vertical`. Edge paddings
 * compose with (and win over) the all-edges value, exactly like chained
 * SwiftUI padding modifiers.
 */
@Directive({
  selector: '[uiPadding], [uiPaddingHorizontal], [uiPaddingVertical]',
  host: {
    '[attr.data-padding]': 'uiPadding() ?? null',
    '[attr.data-padding-horizontal]': 'uiPaddingHorizontal() ?? null',
    '[attr.data-padding-vertical]': 'uiPaddingVertical() ?? null',
  },
})
export class UiPaddingDirective {
  readonly uiPadding = input(undefined, { transform: bareToRegular });
  readonly uiPaddingHorizontal = input(undefined, {
    transform: bareToRegular,
  });
  readonly uiPaddingVertical = input(undefined, { transform: bareToRegular });
}
