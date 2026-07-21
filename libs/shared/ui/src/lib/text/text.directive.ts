import { Directive, booleanAttribute, computed, input } from '@angular/core';

/**
 * ≙ SwiftUI `Font.TextStyle` — one name per `--cr-text-*` role token
 * (tokens.css). `display`/`eyebrow` are house-specific additions;
 * `largeTitle` follows SwiftUI's camelCase (matching ButtonSize's
 * `extraLarge` precedent).
 */
export type FontTextStyle =
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

/** ≙ SwiftUI `Font.Weight` — the modifier scale, NOT per-role identity weights. */
export type FontWeight = 'regular' | 'medium' | 'semibold' | 'bold';
/** ≙ SwiftUI `Font.Design`: which of the two token families to force. */
export type FontDesign = 'heading' | 'content';
/** ≙ SwiftUI `Font.Width` — Roboto Flex's variable width axis via font-stretch. */
export type FontWidth = 'condensed' | 'standard' | 'expanded';
/** ≙ SwiftUI `foregroundStyle`, restricted to semantic color roles. */
export type ForegroundStyle =
  | 'primary'
  | 'secondary'
  | 'tertiary'
  | 'accent'
  | 'danger'
  | 'success'
  | 'warning';
/** ≙ SwiftUI `Text.Case`. `none` cancels a role's own transform (eyebrow). */
export type TextCase = 'uppercase' | 'lowercase' | 'none';
/** Tracking escape hatches (--cr-tracking-*); roles carry their own.
 * (SwiftUI's `.tracking()` takes CGFloat — deliberately narrowed to tokens.) */
export type TextTracking = 'tight' | 'wide';

/**
 * SwiftUI-`Text`-inspired typography modifiers as an attribute directive —
 * deliberately NOT a `<cr-text>` element: a wrapper would add a DOM node
 * per text run and fight native h1-h6/p semantics, whereas this compiles
 * to plain `data-text-*` attributes on the element you already have
 * (the MaterialDirective pattern). All styling lives in typography.css's
 * global `@layer cr-base` rules keyed on those attributes, so static
 * markup (`<p data-text="footnote">`) keeps working with zero JS.
 *
 * The template mirrors SwiftUI 1:1 — `crText` is `Text(…)` itself (the
 * `cr` prefix is only on the SELECTOR, mandated by Angular's style guide:
 * a bare `[font]`/`[text]` selector would instantiate this directive on
 * any element carrying such an attribute); every input is a verbatim
 * SwiftUI modifier:
 *
 *   Text("…").font(.title).fontWeight(.semibold)
 *   <h2 crText font="title" fontWeight="semibold">…</h2>
 *
 *   Text("…").bold().italic()
 *   <span crText bold italic>…</span>
 *
 * Role metrics are single-sourced in the `--cr-text-*` tokens; modifiers
 * only exist for the axes SwiftUI models. There is deliberately no numeric
 * font-size input (`.font(.system(size:))` is not ported) — an off-ramp
 * size is a token change, not a call-site override. See
 * docs/design-research/swiftui-text-modifiers-research.md.
 */
@Directive({
  selector: '[crText]',
  host: {
    '[attr.data-text]': 'font() || null',
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
export class CrText {
  /** ≙ `.font(.title)` — omitted = marker only; element keeps inherited metrics. */
  readonly font = input<FontTextStyle | ''>('');
  readonly fontWeight = input<FontWeight | undefined>(undefined);
  /** ≙ `.bold()` — sugar for fontWeight="bold"; explicit fontWeight wins. */
  readonly bold = input(false, { transform: booleanAttribute });
  /** ≙ `.italic()` — real oblique via Roboto Flex's slnt axis (typography.css). */
  readonly italic = input(false, { transform: booleanAttribute });
  readonly fontDesign = input<FontDesign | undefined>(undefined);
  readonly fontWidth = input<FontWidth | undefined>(undefined);
  readonly foregroundStyle = input<ForegroundStyle | undefined>(undefined);
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
