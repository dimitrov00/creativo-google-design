import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/** Instagram — Material Symbols carries no brand glyphs; the v2 inline mark.
 *  The svg attribute selector keeps the glyph inside the SVG namespace; the
 *  `cr` prefix is in the attribute name. */
@Component({
  // eslint-disable-next-line @angular-eslint/component-selector
  selector: 'svg[crIconInstagram]',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': '2',
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    'aria-hidden': 'true',
  },
  template: `<svg:rect x="2" y="2" width="20" height="20" rx="5" />
    <svg:circle cx="12" cy="12" r="4" />
    <svg:circle cx="17.5" cy="6.5" r="0.5" fill="currentColor" />`,
})
export class IconInstagram {}

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
