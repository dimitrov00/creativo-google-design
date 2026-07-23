import { Directive, input } from '@angular/core';

export type UiMaterialTier = 'thin' | 'regular' | 'thick';

/**
 * ≙ SwiftUI `.background(.thinMaterial / .regularMaterial / .thickMaterial)`
 * — writes `data-material`. The one sanctioned glass/blur recipe: modifiers.css
 * maps each tier to `--sys-material-*-blur` (14 / 20 / 40px) with the shared
 * `--sys-material-fill` surface-alpha and `--sys-material-saturation`.
 * Replaces every hand-rolled `backdrop-filter: blur(...)` chrome recipe
 * (and retires legacy `crMaterial` for these tiers).
 */
@Directive({
  selector: '[uiMaterial]',
  host: { '[attr.data-material]': 'uiMaterial()' },
})
export class UiMaterialDirective {
  readonly uiMaterial = input<UiMaterialTier>('regular');
}
