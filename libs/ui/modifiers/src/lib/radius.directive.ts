import { Directive, input } from '@angular/core';

export type UiRadiusScale = 'subtle' | 'regular' | 'prominent' | 'capsule';

/** ≙ SwiftUI `.clipShape(RoundedRectangle(cornerRadius:))` — writes `data-radius`. */
@Directive({
  selector: '[uiRadius]',
  host: { '[attr.data-radius]': 'uiRadius()' },
})
export class UiRadiusDirective {
  readonly uiRadius = input<UiRadiusScale>('regular');
}
