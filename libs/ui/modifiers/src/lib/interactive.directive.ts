import { Directive } from '@angular/core';

/**
 * ≙ SwiftUI `.hoverEffect(.highlight)` — writes `data-interactive`.
 *
 * THE one sanctioned hover/press grammar for interactive surfaces (cards,
 * rows, tiles): a state-layer overlay that fills with
 * `--sys-state-layer-hover` on hover and `--sys-state-layer-press` on
 * press (see modifiers.css). Surfaces must not invent their own hover
 * treatments — at most one signature embellishment (e.g. an image zoom)
 * may ride alongside the layer. ui-button/ui-chip carry their own
 * per-variant tiers and don't need this.
 */
@Directive({
  selector: '[uiInteractive]',
  host: { 'data-interactive': '' },
})
export class UiInteractiveDirective {}
