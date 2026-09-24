import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/* The Instagram mark moved into the icon registry as `social.instagram`
   (libs/ui/icons, a vector entry) — brand marks are vocabulary, not
   per-feature SVG. What stays here is a CONTROL, not a glyph: */

/** Animated hamburger ⟷ close — the pre-migration landing's two-line mark:
 *  two bars pivot into an ✕ (not v2's three-bar morph, by design call). */
@Component({
  selector: 'cr-menu-icon',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'cr-menu-icon',
    '[attr.data-open]': 'open() ? "" : null',
    'aria-hidden': 'true',
  },
  template: `<span class="cr-menu-icon__bar" data-bar="top"></span
    ><span class="cr-menu-icon__bar" data-bar="bottom"></span>`,
  styles: `
    /* KEPT: fully hand-drawn SIGNATURE glyph geometry (the two-bar
       hamburger→X morph has no Material Symbol / registry equivalent) —
       the px values are the mark's own design, not layout tokens. */
    :host {
      position: relative;
      display: inline-block;
      block-size: 12px;
      inline-size: 18px;
      flex-shrink: 0;
    }
    .cr-menu-icon__bar {
      position: absolute;
      left: 0;
      inline-size: 18px;
      block-size: 1.5px;
      border-radius: var(--control-radius-capsule);
      background: currentColor;
      transition: transform var(--sys-motion-duration-deliberate)
        var(--sys-motion-ease-entrance);
    }
    .cr-menu-icon__bar[data-bar='top'] {
      top: 2px;
    }
    .cr-menu-icon__bar[data-bar='bottom'] {
      top: 9px;
    }
    :host([data-open]) .cr-menu-icon__bar[data-bar='top'] {
      transform: translateY(3.5px) rotate(45deg);
    }
    :host([data-open]) .cr-menu-icon__bar[data-bar='bottom'] {
      transform: translateY(-3.5px) rotate(-45deg);
    }
  `,
})
export class MenuIconComponent {
  readonly open = input(false);
}
