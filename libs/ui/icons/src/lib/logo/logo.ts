import {
  ChangeDetectionStrategy,
  Component,
  ViewEncapsulation,
  computed,
  inject,
  input,
} from '@angular/core';
import { UiIconAsset, type UiLogoAsset } from '../manifest/icon-manifest';
import { UiIconRegistry } from '../registry/icon-registry.service';

export type UiLogoScheme = 'light' | 'dark';

interface LogoVariant {
  /** `'any'` when one asset serves both schemes (the usual `currentColor` case). */
  readonly scheme: UiLogoScheme | 'any';
  readonly asset: UiLogoAsset;
}

/**
 * The brand mark, through the same registry as every icon.
 *
 * The manifest's logo has a `light` asset and an optional `dark` one. When
 * they are the same (or `dark` is absent) one mark is drawn and follows the
 * ink — the bundled wordmark is path data in `currentColor`, so the header
 * colours it by setting `color`, exactly as it colours a glyph. When they
 * differ (a raster logo with two cuts) both are drawn and CSS shows the one
 * `<html data-theme>` asks for: no JavaScript listens to the theme, so the
 * pre-paint script's choice is honoured from the first frame. `uiScheme`
 * forces a variant regardless of theme (a light header over a dark video).
 *
 * `IMAGE` assets go through `<img>`, where the platform disables scripting
 * and external loads for SVG; width/height are set so the box is reserved.
 *
 *   <ui-logo uiLabel="Creativo" />                  <!-- announced as the brand -->
 *   <ui-logo />                                     <!-- decorative, e.g. beside the name -->
 *   <ui-logo uiScheme="dark" />                     <!-- over media -->
 */
@Component({
  selector: 'ui-logo',
  template: `
    @for (variant of variants(); track variant.scheme) {
      @if (variant.asset.iconAsset === UiIconAsset.Vector) {
        <svg
          class="ui-logo__mark"
          [attr.data-scheme]="variant.scheme"
          [attr.viewBox]="variant.asset.viewBox"
          fill="currentColor"
          focusable="false"
          aria-hidden="true"
        >
          @for (path of variant.asset.paths; track $index) {
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
      } @else {
        <img
          class="ui-logo__mark"
          [attr.data-scheme]="variant.scheme"
          [src]="variant.asset.href"
          [width]="variant.asset.width"
          [height]="variant.asset.height"
          alt=""
          aria-hidden="true"
          decoding="async"
        />
      }
    }
  `,
  styleUrl: './logo.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  host: {
    class: 'ui-logo',
    '[attr.role]': 'uiLabel() ? "img" : null',
    '[attr.aria-label]': 'uiLabel() || null',
    '[attr.aria-hidden]': 'uiLabel() ? null : "true"',
    '[attr.data-scheme]': 'uiScheme()',
  },
})
export class UiLogo {
  /** Accessible name — the brand. Absent = decorative. */
  readonly uiLabel = input<string | null>(null);
  /** Force a colour scheme instead of following `<html data-theme>`. */
  readonly uiScheme = input<UiLogoScheme | null>(null);

  private readonly registry = inject(UiIconRegistry);
  /** The asset dictionary, for the template's compare (D-8.7). */
  protected readonly UiIconAsset = UiIconAsset;

  protected readonly variants = computed<readonly LogoVariant[]>(() => {
    const logo = this.registry.logo();
    const dark = logo.dark ?? logo.light;
    if (sameAsset(logo.light, dark)) {
      return [{ scheme: 'any', asset: logo.light }];
    }
    return [
      { scheme: 'light', asset: logo.light },
      { scheme: 'dark', asset: dark },
    ];
  });
}

function sameAsset(a: UiLogoAsset, b: UiLogoAsset): boolean {
  return a === b || JSON.stringify(a) === JSON.stringify(b);
}
