import { Directive, input } from '@angular/core';

/**
 * ≙ SwiftUI's `HierarchicalShapeStyle` ladder plus the semantic roles.
 * `tertiary` is the real third rung, not a synonym for `secondary`: it is
 * for content that is present but not currently actionable — a calendar day
 * with nothing free — which should not read as loudly as a caption that is
 * simply supporting text. `warning` is ink for a state's GLYPH (a no-show's
 * mark beside its word): the word beside it keeps the primary ink.
 *
 * THE ACCENT LAW (2026-09-29): `accent` and `promo` paint the main accent,
 * so they belong to a glyph (`ui-icon`) or to a display figure (`title2`
 * and up, `title3` only in bold), never to small words. A small word that
 * has to feel orange stays ink and takes an orange thing beside it.
 * `accent-rule.spec.ts` (libs/ui/tokens) holds every template to it.
 */
export type UiForegroundStyle =
  | 'primary'
  | 'secondary'
  | 'tertiary'
  | 'accent'
  | 'destructive'
  | 'success'
  | 'warning'
  | 'promo';

/**
 * ≙ SwiftUI `.foregroundStyle(_:)` — writes `data-foreground-style`.
 *
 * UNSET writes nothing: the element inherits its ink, as it always did. An
 * EXPLICIT `primary` stamps the attribute and takes the ink back, so a fact
 * inside a quiet line is ink instead of the grey it would inherit.
 */
@Directive({
  selector: '[uiForegroundStyle]',
  host: { '[attr.data-foreground-style]': 'attrValue()' },
})
export class UiForegroundStyleDirective {
  readonly uiForegroundStyle = input<UiForegroundStyle | undefined>(undefined);

  protected attrValue(): string | null {
    return this.uiForegroundStyle() ?? null;
  }
}
