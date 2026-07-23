import { Directive, input } from '@angular/core';

/**
 * ≙ SwiftUI `.frame(width:height:)` / `.frame(maxWidth:alignment:)` with
 * `.center` alignment. Writes raw inline `inline-size`/`block-size`/
 * `max-inline-size` — the one modifier that legitimately takes a CSS length
 * rather than a token name, since arbitrary sizing (an image frame, a
 * fixed-width column) has no finite semantic scale to draw from.
 * `var(--sys-container-*)` expressions are welcome values.
 *
 * When `uiFrameMaxWidth` is set the element becomes a centered max-width
 * column: `max-inline-size` plus `inline-size: 100%; margin-inline: auto`
 * (unless an explicit `uiFrameWidth` overrides the inline size).
 *
 * `uiFrameMaxWidth="infinity"` ≙ SwiftUI `.frame(maxWidth: .infinity)`:
 * fill the available inline space with no cap. This is THE way to make a
 * hug-by-default control (e.g. uiButton) full-width — controls never
 * stretch on their own. In a flex row the 100% becomes the flex-basis and
 * shrink absorbs it back to the leftover space, so it composes with
 * fixed-size siblings.
 */
@Directive({
  selector: '[uiFrame]',
  host: {
    '[style.inline-size]': 'inlineSize()',
    '[style.block-size]': 'uiFrameHeight() ?? null',
    '[style.max-inline-size]': 'maxInlineSize()',
    '[style.margin-inline]': 'marginInline()',
  },
})
export class UiFrameDirective {
  readonly uiFrameWidth = input<string | undefined>(undefined);
  readonly uiFrameHeight = input<string | undefined>(undefined);
  readonly uiFrameMaxWidth = input<string | undefined>(undefined);

  protected inlineSize(): string | null {
    return (
      this.uiFrameWidth() ??
      (this.uiFrameMaxWidth() !== undefined ? '100%' : null)
    );
  }

  protected maxInlineSize(): string | null {
    const max = this.uiFrameMaxWidth();
    // .frame(maxWidth: .infinity) — fill, no cap.
    return max === undefined || max === 'infinity' ? null : max;
  }

  protected marginInline(): string | null {
    const max = this.uiFrameMaxWidth();
    // A filling frame needs no centering; a capped column centers itself.
    return max === undefined || max === 'infinity' ? null : 'auto';
  }
}
