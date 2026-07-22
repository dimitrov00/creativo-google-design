import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * The landing's icon vocabulary — Material Symbols Rounded (filled), the same
 * ligature-font approach the pre-migration landing used (`material-symbols`
 * package, imported in apps/web/src/styles.css). One component, glyph by
 * name; size follows the host's `font-size` so call sites scale icons with
 * one property.
 *
 *   <cr-icon name="calendar_month" class="cr-hero__glyph" />
 *   .cr-hero__glyph { font-size: 18px; }
 */
@Component({
  selector: 'cr-icon',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'cr-icon', 'aria-hidden': 'true' },
  template: `<span class="material-symbols-rounded">{{ name() }}</span>`,
  styles: `
    :host {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      line-height: 1;
      flex-shrink: 0;
    }
    span {
      font-size: inherit;
      /* Filled style, per the design call. */
      font-variation-settings:
        'FILL' 1,
        'wght' 400,
        'GRAD' 0,
        'opsz' 24;
    }
  `,
})
export class CrIcon {
  readonly name = input.required<string>();
}

/** Instagram — Material Symbols carries no brand glyphs; the v2 inline mark.
 *  The svg attribute selector keeps the glyph inside the SVG namespace; the
 *  `cr` prefix is in the attribute name. */
@Component({
  // eslint-disable-next-line @angular-eslint/component-selector
  selector: 'svg[crIconInstagram]',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'cr-icon',
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
      border-radius: 9999px;
      background: currentColor;
      transition: transform 0.3s cubic-bezier(0.16, 1, 0.3, 1);
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
