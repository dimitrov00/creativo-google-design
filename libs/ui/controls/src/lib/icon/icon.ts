import {
  ChangeDetectionStrategy,
  Component,
  ViewEncapsulation,
  computed,
  inject,
  input,
} from '@angular/core';
import { UI_ICON_OVERRIDES, UiIconName, resolveUiIcon } from './icon-registry';

/**
 * The FIXED icon size ladder (owner ruling): explicit scales snap to
 * absolute rem steps, never font-derived fractions — font-relative math
 * produced odd in-between glyph sizes (17.5px beside 20px beside 24px)
 * that read as badly designed. The three steps live as custom properties
 * in icon.css so contexts (button.css tiers, list rows) reference the
 * same values:
 *
 * | uiScale    | glyph box                     |
 * |------------|-------------------------------|
 * | `'small'`  | `--ui-icon-small`  1rem (16px)  |
 * | `'medium'` | `--ui-icon-medium` 1.25rem (20px) |
 * | `'large'`  | `--ui-icon-large`  1.5rem (24px)  |
 *
 * ABSENT (the default) is not a ladder step: an unscaled icon keeps the
 * SwiftUI font-riding behavior (1em — glyph matches the surrounding
 * text), which is correct for glyphs inline in running text.
 */
export type UiIconScale = 'small' | 'medium' | 'large';

/**
 * Custom element — the design system's one icon vocabulary (SwiftUI
 * `Image(systemName:)`): Material Symbols Rounded, filled, glyph by
 * ligature name. Promotion of the landing's CrIcon so raw
 * `material-symbols` spans (which rendered UNFILLED) stop re-pasting the
 * glyph-box reset.
 *
 * Naming model — SEMANTIC, type-safe: `uiName` takes a `UiIconName`
 * intent key from icon-registry.ts (`'appointment.book'`,
 * `'sheet.close'`), NEVER a raw Material Symbol ligature. The component
 * resolves intent → glyph through the registry (plus any
 * `provideUiIcons(...)` overrides), so intents that share a glyph today
 * can diverge later by editing one registry line — see icon/README.md.
 *
 * Sizing model — two regimes, chosen by whether `uiScale` is set:
 *
 * 1. UNSCALED (default, no `data-scale` stamped): like
 *    `Image(systemName:)`, the glyph inherits its size from the current
 *    font — `font-size: 1em` on the em box, so an arrow in footer copy
 *    is copy-sized and a caption glyph is caption-sized. This is the
 *    right mode for glyphs inline in running text.
 * 2. EXPLICIT `uiScale`: the glyph SNAPS to the fixed ladder —
 *    small 1rem · medium 1.25rem · large 1.5rem (`--ui-icon-*` in
 *    icon.css) — detaching it from the surrounding font. This is the
 *    right mode for control/accessory glyphs, where font-derived sizes
 *    produced off-ladder in-between values.
 *
 *   <ui-icon uiName="footer.arrow" />                        <!-- rides the text -->
 *   <ui-icon uiName="appointment.launch" uiScale="large" />  <!-- fixed 24px -->
 *
 * The ligature font itself ships via the `material-symbols` package
 * imported once in each app's styles.css (pre-existing contract). That
 * vendor stylesheet is UNLAYERED, so icon.css beats its fixed
 * `font-size: 24px` with an unlayered rule of its own (see icon.css).
 */
@Component({
  selector: 'ui-icon',
  template: `<span class="ui-icon__glyph material-symbols-rounded">{{
    glyph()
  }}</span>`,
  styleUrl: './icon.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Unscoped: bare `.ui-*`/`[data-*]` selectors never match a component's
  // own HOST element under emulated encapsulation (see avatar.ts) — and
  // global `.ui-*` classes are this system's actual styling contract (§3.1).
  encapsulation: ViewEncapsulation.None,
  host: {
    class: 'ui-icon',
    'aria-hidden': 'true',
    '[attr.data-scale]': 'uiScale()',
  },
})
export class UiIcon {
  /** Semantic intent key (`UiIconName`) — resolved to a Material Symbols
   *  glyph through the registry. Raw ligature names are a type error. */
  readonly uiName = input.required<UiIconName>();
  /** Fixed size ladder — small 1rem · medium 1.25rem · large 1.5rem.
   *  Default `null`: no `data-scale` is stamped and the glyph rides the
   *  current font (1em), the correct behavior inline in running text.
   *  Set a step to detach the glyph onto the ladder (control glyphs,
   *  accessories). */
  readonly uiScale = input<UiIconScale | null>(null);

  private readonly overrides = inject(UI_ICON_OVERRIDES, { optional: true });

  /** Resolved ligature: overrides (last-wins) → registry → raw fallback
   *  (runtime safety net for un-migrated call sites; the input TYPE is the
   *  compile-time gate). */
  protected readonly glyph = computed(() =>
    resolveUiIcon(this.uiName(), this.overrides),
  );
}
