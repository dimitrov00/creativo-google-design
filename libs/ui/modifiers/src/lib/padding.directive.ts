import { Directive, input } from '@angular/core';

export type UiPaddingScale =
  | 'none'
  | 'tight'
  | 'compact'
  | 'regular'
  | 'comfortable'
  | 'loose'
  | 'spacious';

/** ≙ SwiftUI `.padding(_:)` — writes `data-padding`. */
@Directive({
  selector: '[uiPadding]',
  host: { '[attr.data-padding]': 'uiPadding()' },
})
export class UiPaddingDirective {
  readonly uiPadding = input<UiPaddingScale>('regular');
}
