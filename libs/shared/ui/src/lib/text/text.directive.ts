import { Directive, input } from '@angular/core';

/**
 * SwiftUI `Font.TextStyle`-shaped role vocabulary, one name per
 * `--cr-text-*` role token (tokens.css). `display`/`eyebrow` are
 * house-specific additions; `largeTitle` follows SwiftUI's camelCase
 * (matching ButtonSize's `extraLarge` precedent).
 */
export type TextRole =
  | 'display'
  | 'largeTitle'
  | 'title'
  | 'title2'
  | 'title3'
  | 'headline'
  | 'callout'
  | 'body'
  | 'subheadline'
  | 'footnote'
  | 'caption'
  | 'eyebrow';

/** Modifier weights — the token scale, NOT the per-role identity weights. */
export type TextWeight = 'regular' | 'medium' | 'semibold' | 'bold';
/** ≙ SwiftUI fontDesign: which of the two token families to force. */
export type TextDesign = 'heading' | 'content';
/** ≙ SwiftUI fontWidth — Roboto Flex's variable width axis via font-stretch. */
export type TextWidth = 'condensed' | 'standard' | 'expanded';
/** ≙ SwiftUI foregroundStyle, restricted to semantic color roles. */
export type TextTone =
  | 'primary'
  | 'secondary'
  | 'tertiary'
  | 'accent'
  | 'danger'
  | 'success'
  | 'warning';
/** ≙ SwiftUI textCase. `none` cancels a role's own transform (eyebrow). */
export type TextCase = 'uppercase' | 'lowercase' | 'none';
/** Call-site tracking escape hatches (--cr-tracking-*); roles carry their own. */
export type TextTracking = 'tight' | 'wide';

/**
 * SwiftUI-`Text`-inspired typography modifiers as an attribute directive —
 * deliberately NOT a `<cr-text>` element: a wrapper would add a DOM node
 * per text run and fight native h1-h6/p semantics, whereas this compiles
 * to plain `data-text-*` attributes on the element you already have
 * (the MaterialDirective pattern). All styling lives in typography.css's
 * global `@layer cr-base` rules keyed on those attributes, so static
 * markup (`<p data-text="footnote">`) keeps working with zero JS — the
 * directive adds the typed vocabulary, not a runtime dependency.
 *
 * Role metrics are single-sourced in the `--cr-text-*` tokens; modifiers
 * only exist for the axes SwiftUI models (weight/design/width/tone/case/
 * decoration/tracking). There is deliberately no numeric font-size input —
 * an off-ramp size is a token change, not a call-site override.
 */
@Directive({
  selector: '[crText]',
  host: {
    '[attr.data-text]': 'role()',
    '[attr.data-text-weight]': 'weight() ?? null',
    '[attr.data-text-design]': 'design() ?? null',
    '[attr.data-text-width]': 'width() ?? null',
    '[attr.data-text-tone]': 'tone() ?? null',
    '[attr.data-text-case]': 'textCase() ?? null',
    '[attr.data-text-tracking]': 'tracking() ?? null',
    '[attr.data-text-underline]': 'underline() ? "" : null',
    '[attr.data-text-strike]': 'strikethrough() ? "" : null',
  },
})
export class TextDirective {
  readonly role = input.required<TextRole>({ alias: 'crText' });
  readonly weight = input<TextWeight | undefined>(undefined);
  readonly design = input<TextDesign | undefined>(undefined);
  readonly width = input<TextWidth | undefined>(undefined);
  readonly tone = input<TextTone | undefined>(undefined);
  readonly textCase = input<TextCase | undefined>(undefined);
  readonly tracking = input<TextTracking | undefined>(undefined);
  readonly underline = input(false);
  readonly strikethrough = input(false);
}
