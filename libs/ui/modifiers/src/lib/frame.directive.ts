import { Directive, input } from '@angular/core';

/**
 * ≙ SwiftUI `.frame(width:height:)`. Writes raw inline `inline-size`/`block-size` —
 * the one modifier that legitimately takes a CSS length rather than a token
 * name, since arbitrary sizing (an image frame, a fixed-width column) has no
 * finite semantic scale to draw from.
 */
@Directive({
  selector: '[uiFrame]',
  host: {
    '[style.inline-size]': 'uiFrameWidth() ?? null',
    '[style.block-size]': 'uiFrameHeight() ?? null',
  },
})
export class UiFrameDirective {
  readonly uiFrameWidth = input<string | undefined>(undefined);
  readonly uiFrameHeight = input<string | undefined>(undefined);
}
