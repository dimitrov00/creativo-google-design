import {
  ChangeDetectionStrategy,
  Component,
  ViewEncapsulation,
  computed,
  inject,
  input,
  isDevMode,
} from '@angular/core';
import type { UiIconName } from '../manifest/icon-vocabulary';
import {
  UI_ICON_OVERRIDES,
  UiIconRegistry,
} from '../registry/icon-registry.service';

/**
 * The FIXED icon size ladder (owner ruling): explicit scales snap to
 * absolute rem steps, never font-derived fractions — font-relative math
 * produced odd in-between glyph sizes (17.5px beside 20px beside 24px)
 * that read as badly designed. The three steps live as custom properties
 * in icon.css so contexts (button.css tiers, list rows) reference the
 * same values:
 *
 * | uiScale    | glyph box                         |
 * |------------|-----------------------------------|
 * | `'small'`  | `--ui-icon-small`  1rem (16px)    |
 * | `'medium'` | `--ui-icon-medium` 1.25rem (20px) |
 * | `'large'`  | `--ui-icon-large`  1.5rem (24px)  |
 *
 * ABSENT (the default) is not a ladder step: an unscaled icon keeps the
 * SwiftUI font-riding behavior (1em — glyph matches the surrounding
 * text), which is correct for glyphs inline in running text.
 */
export type UiIconScale = 'small' | 'medium' | 'large';

/**
 * The design system's one icon surface — SwiftUI `Image(systemName:)`.
 *
 * `uiName` takes a semantic key (`UiIconName`), never artwork: the registry
 * resolves it through DI overrides → the remote manifest → the bundled
 * vocabulary, and hands back inert path data that this component draws as
 * an inline `<svg>` sized to the em box. Rendering is synchronous — there
 * is no font to load, so nothing flashes and nothing shifts.
 *
 * Sizing — two regimes, chosen by whether `uiScale` is set:
 *
 * 1. UNSCALED (default, no `data-scale`): the glyph is `1em`, inheriting the
 *    current font like an SF Symbol inline in text.
 * 2. EXPLICIT `uiScale`: the glyph SNAPS to the fixed ladder (small 1rem ·
 *    medium 1.25rem · large 1.5rem — `--ui-icon-*` in icon.css).
 *
 * Accessibility — decorative by default (`aria-hidden`), which is right for
 * a glyph beside a label. A glyph that IS the information takes `uiLabel`
 * and becomes `role="img"` with that name.
 *
 * Failure — a key that cannot resolve renders an empty em box stamped
 * `data-missing` (dashed in development) and is reported once through
 * `UI_ICON_REPORTER`; it never throws.
 *
 *   <ui-icon uiName="footer.arrow" />                          <!-- rides the text -->
 *   <ui-icon uiName="appointment.launch" uiScale="large" />    <!-- fixed 24px -->
 *   <ui-icon uiName="visit.noShow" uiLabel="Не дойде" />       <!-- announced -->
 */
@Component({
  selector: 'ui-icon',
  template: `
    @if (asset(); as glyph) {
      <svg
        class="ui-icon__glyph"
        [attr.viewBox]="glyph.viewBox"
        fill="currentColor"
        focusable="false"
        aria-hidden="true"
      >
        @for (path of glyph.paths; track $index) {
          <svg:path
            [attr.d]="path.d"
            [attr.fill]="path.fill ?? null"
            [attr.stroke]="path.stroke ?? null"
            [attr.stroke-width]="path.strokeWidth ?? null"
            [attr.stroke-linecap]="path.strokeLinecap ?? null"
            [attr.stroke-linejoin]="path.strokeLinejoin ?? null"
          />
        }
      </svg>
    }
  `,
  styleUrl: './icon.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Unscoped: bare `.ui-*`/`[data-*]` selectors never match a component's
  // own HOST element under emulated encapsulation — and global `.ui-*`
  // classes are this system's actual styling contract (§3.1).
  encapsulation: ViewEncapsulation.None,
  host: {
    class: 'ui-icon',
    '[attr.aria-hidden]': 'uiLabel() ? null : "true"',
    '[attr.role]': 'uiLabel() ? "img" : null',
    '[attr.aria-label]': 'uiLabel() || null',
    '[attr.data-scale]': 'uiScale()',
    /*
     * The INTENT, stamped so CSS can reach it. A rule written against the
     * intent (`[data-name='field.expand']` rotates when its trigger opens)
     * keeps meaning what it meant when the artwork changes underneath.
     */
    '[attr.data-name]': 'uiName()',
    '[attr.data-missing]': 'asset() ? null : missingMark',
  },
})
export class UiIcon {
  /** Semantic intent key — a raw glyph name is a type error. */
  readonly uiName = input.required<UiIconName>();
  /** Fixed ladder step; `null` (default) rides the current font. */
  readonly uiScale = input<UiIconScale | null>(null);
  /** Accessible name. Set it only when the glyph carries the meaning alone. */
  readonly uiLabel = input<string | null>(null);

  private readonly registry = inject(UiIconRegistry);
  private readonly overrides = inject(UI_ICON_OVERRIDES, { optional: true });

  /** `'loud'` draws the dashed placeholder; production stamps a bare flag. */
  protected readonly missingMark = isDevMode() ? 'loud' : '';

  protected readonly asset = computed(() =>
    this.registry.resolve(this.uiName(), this.overrides),
  );
}
