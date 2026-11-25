import { Directive, input } from '@angular/core';

export type UiRadiusScale =
  'subtle' | 'regular' | 'prominent' | 'hero' | 'capsule';

/**
 * ≙ SwiftUI `.clipShape(RoundedRectangle(cornerRadius:))` — writes `data-radius`.
 *
 * @uiPurpose Rounds an element's corners with a token radius.
 * @uiSwiftUI `.clipShape(RoundedRectangle(cornerRadius:))`
 * @uiAliases border-radius, rounded corners, corner radius, radius, clip
 */
@Directive({
  selector: '[uiRadius]',
  host: { '[attr.data-radius]': 'uiRadius()' },
})
export class UiRadiusDirective {
  readonly uiRadius = input<UiRadiusScale>('regular');
}
