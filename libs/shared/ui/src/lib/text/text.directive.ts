import { Directive, booleanAttribute, computed, input } from '@angular/core';

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

/** ≙ SwiftUI Font.Weight — the modifier scale, NOT per-role identity weights. */
export type TextWeight = 'regular' | 'medium' | 'semibold' | 'bold';
/** ≙ SwiftUI Font.Design: which of the two token families to force. */
export type TextDesign = 'heading' | 'content';
/** ≙ SwiftUI Font.Width — Roboto Flex's variable width axis via font-stretch. */
export type TextWidth = 'condensed' | 'standard' | 'expanded';
/** ≙ SwiftUI foregroundStyle, restricted to semantic color roles. */
export type TextForegroundStyle =
  | 'primary'
  | 'secondary'
  | 'tertiary'
  | 'accent'
  | 'danger'
  | 'success'
  | 'warning';
/** ≙ SwiftUI Text.Case. `none` cancels a role's own transform (eyebrow). */
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
 * Inputs follow SwiftUI's Text modifier names verbatim (fontWeight,
 * fontDesign, fontWidth, foregroundStyle, bold, italic, …). Bare `crText`
 * with no role is the `Text(…)` marker itself — it stamps no `data-text`,
 * so the element keeps its inherited metrics and only the modifiers apply
 * (SwiftUI modifiers never float free of a Text either; see
 * docs/design-research/swiftui-text-modifiers-research.md).
 *
 * Role metrics are single-sourced in the `--cr-text-*` tokens; modifiers
 * only exist for the axes SwiftUI models. There is deliberately no numeric
 * font-size input (`.font(.system(size:))` is not ported) — an off-ramp
 * size is a token change, not a call-site override.
 */
@Directive({
  selector: '[crText]',
  host: {
    '[attr.data-text]': 'role() || null',
    '[attr.data-text-weight]': 'resolvedWeight() ?? null',
    '[attr.data-text-design]': 'fontDesign() ?? null',
    '[attr.data-text-width]': 'fontWidth() ?? null',
    '[attr.data-text-tone]': 'foregroundStyle() ?? null',
    '[attr.data-text-case]': 'textCase() ?? null',
    '[attr.data-text-tracking]': 'tracking() ?? null',
    '[attr.data-text-italic]': 'italic() ? "" : null',
    '[attr.data-text-underline]': 'underline() ? "" : null',
    '[attr.data-text-strike]': 'strikethrough() ? "" : null',
    '[attr.data-text-monospaced-digit]': 'monospacedDigit() ? "" : null',
  },
})
export class TextDirective {
  /** ≙ `.font(.title)` — empty/omitted value = marker only, no role stamp. */
  readonly role = input<TextRole | ''>('', { alias: 'crText' });
  readonly fontWeight = input<TextWeight | undefined>(undefined);
  /** ≙ `.bold()` — sugar for fontWeight="bold"; explicit fontWeight wins. */
  readonly bold = input(false, { transform: booleanAttribute });
  /** ≙ `.italic()` — real oblique via Roboto Flex's slnt axis (typography.css). */
  readonly italic = input(false, { transform: booleanAttribute });
  readonly fontDesign = input<TextDesign | undefined>(undefined);
  readonly fontWidth = input<TextWidth | undefined>(undefined);
  readonly foregroundStyle = input<TextForegroundStyle | undefined>(undefined);
  readonly textCase = input<TextCase | undefined>(undefined);
  readonly tracking = input<TextTracking | undefined>(undefined);
  readonly underline = input(false, { transform: booleanAttribute });
  readonly strikethrough = input(false, { transform: booleanAttribute });
  /** ≙ `.monospacedDigit()` — tabular figures, proportional everything else. */
  readonly monospacedDigit = input(false, { transform: booleanAttribute });

  protected readonly resolvedWeight = computed(
    () => this.fontWeight() ?? (this.bold() ? 'bold' : undefined),
  );
}
