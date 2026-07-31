import { Directive, input } from '@angular/core';

/**
 * ≙ SwiftUI's `HierarchicalShapeStyle` ladder plus the two semantic roles.
 * `tertiary` is the real third rung, not a synonym for `secondary`: it is
 * for content that is present but not currently actionable — a calendar day
 * with nothing free — which should not read as loudly as a caption that is
 * simply supporting text.
 */
export type UiForegroundStyle =
  'primary' | 'secondary' | 'tertiary' | 'accent' | 'destructive';

/** ≙ SwiftUI `.foregroundStyle(_:)` — writes `data-foreground-style`. `primary` omits the attribute (inherited color). */
@Directive({
  selector: '[uiForegroundStyle]',
  host: { '[attr.data-foreground-style]': 'attrValue()' },
})
export class UiForegroundStyleDirective {
  readonly uiForegroundStyle = input<UiForegroundStyle>('primary');

  protected attrValue(): string | null {
    const value = this.uiForegroundStyle();
    return value === 'primary' ? null : value;
  }
}
