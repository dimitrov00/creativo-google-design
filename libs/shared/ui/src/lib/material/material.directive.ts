import { Directive, input } from '@angular/core';

export type MaterialTier =
  'none' | 'ultra-thin' | 'thin' | 'regular' | 'thick' | 'ultra-thick';

/**
 * Applies one of the SwiftUI/UIKit-style Materials tiers (none/ultra-thin/
 * thin/regular/thick/ultra-thick — see the --cr-material-* tokens in
 * libs/shared/design-tokens/css/tokens.css and material.css's
 * `[data-material]` rules) to
 * an arbitrary element: a translucent, blurred surface tinted from
 * --cr-color-surface-tint. Reserved for genuine overlay/glass contexts
 * (dropdowns, menus, toasts) — NOT for regular composable surfaces, which
 * should stay opaque via the --cr-color-surface-N elevation tokens instead
 * (see Card). This directive is purely consumer-driven (the tier is always
 * an explicit input, never internally computed), unlike `useCursorTarget` —
 * see docs/design-research/decisions.md for why that distinction matters
 * for whether a behavior is a good `hostDirectives` candidate.
 *
 * `material.css`'s rules are global (unscoped), same reason as
 * `cursor-target.css`: a Directive has no component view, so none of the
 * `[data-material]` styling can live as component-scoped CSS. Import it
 * once per app alongside the design-token CSS files.
 */
@Directive({
  selector: '[crMaterial]',
  host: {
    '[attr.data-material]': 'tier()',
  },
})
export class MaterialDirective {
  readonly tier = input<MaterialTier>('regular', { alias: 'crMaterial' });
}
