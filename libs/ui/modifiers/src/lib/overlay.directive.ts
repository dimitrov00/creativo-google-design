import { Directive, input } from '@angular/core';

export type UiOverlayStyle = 'plain' | 'ring' | 'scrim-media' | 'vignette';

/**
 * ≙ SwiftUI `.overlay(_:)` / `.overlay(RoundedRectangle().strokeBorder(...))`
 * — writes `data-overlay`. The absolute-inset overlay scaffold: every value
 * gets `position: absolute; inset: 0; border-radius: inherit;
 * pointer-events: none` (the parent must be positioned — e.g. a `ui-stack`
 * z-axis layer or any `position: relative` surface).
 *
 * - `plain` — bare scaffold for bespoke content layers (grain, spotlight…).
 * - `ring` — 1px inset hairline from `--sys-color-separator` (flips to the
 *   on-media white hairline under a `data-on-media` ancestor).
 * - `scrim-media` — bottom-anchored legibility gradient built from
 *   `--sys-color-media-scrim`.
 * - `vignette` — center radial grade from the same token (hero set-pieces).
 *
 * Gradient stops live once in modifiers.css — no literal rgb() scrims in
 * feature CSS.
 */
@Directive({
  selector: '[uiOverlay]',
  host: { '[attr.data-overlay]': 'uiOverlay()' },
})
export class UiOverlayDirective {
  readonly uiOverlay = input('plain', {
    // Bare-attribute usage (`<div uiOverlay>`) binds the empty string.
    transform: (value: UiOverlayStyle | ''): UiOverlayStyle =>
      value === '' ? 'plain' : value,
  });
}
