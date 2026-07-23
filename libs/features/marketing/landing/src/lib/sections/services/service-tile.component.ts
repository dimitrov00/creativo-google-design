import {
  ChangeDetectionStrategy,
  Component,
  ViewEncapsulation,
  inject,
  input,
  output,
} from '@angular/core';
import { TranslocoDirective } from '@jsverse/transloco';
import { UiAsyncImage, UiIcon } from '@creativo/ui/controls';
import {
  UiInteractiveDirective,
  UiRadiusDirective,
  UiTextDirective,
} from '@creativo/ui/modifiers';
import { LandingContentService } from '../../content/landing-content.service';
import {
  type ServiceVm,
  servicePriceFrom,
} from '../../content/landing-content';

/**
 * One portrait service tile — the carousel card shared by the singles and
 * bundles shelves (previously ~65 lines copy-pasted per shelf). Cover art
 * is `ui-async-image` (4/5, hairline ring, prominent radius) with the
 * scissors-motif gradient projected as the permanent placeholder for
 * services without a photo; copy roles ride uiText. Hover/press feedback is
 * the shared `[data-interactive]` grammar — the image zoom is this tile's
 * one signature embellishment.
 */
@Component({
  selector: 'cr-service-tile',
  imports: [
    TranslocoDirective,
    UiAsyncImage,
    UiIcon,
    UiInteractiveDirective,
    UiRadiusDirective,
    UiTextDirective,
  ],
  template: `
    <ng-container *transloco="let t">
      <button
        type="button"
        uiInteractive
        uiRadius="prominent"
        class="cr-services__tile"
        [attr.data-testid]="'service-tile-' + service().id"
        (click)="pressed.emit()"
      >
        <span class="cr-services__media">
          <ui-async-image
            class="cr-services__image"
            [uiSrc]="service().coverSrc ?? null"
            uiRatio="4 / 5"
            [uiRing]="true"
            uiRadius="prominent"
          >
            <!-- Graceful degradation — a styled scissors motif reads as
                 intentional, never broken (v2 imageFallback). -->
            <span uiPlaceholder class="cr-services__fallback">
              <ui-icon
                uiName="service.placeholder"
                class="cr-services__fallback-glyph"
              />
            </span>
          </ui-async-image>

          @if (service().kind === 'bundle') {
            <span
              class="cr-services__bundle-chip"
              role="img"
              [attr.aria-label]="t('landing.services.bundle')"
            >
              <ui-icon
                uiName="service.bundle"
                class="cr-services__bundle-glyph"
              />
            </span>
          }
        </span>

        <span class="cr-services__copy">
          <span
            uiText
            uiFont="callout"
            uiWeight="bold"
            class="cr-services__name"
            >{{ content.text(service().name) }}</span
          >
          <span class="cr-services__meta">
            <span uiText uiFont="footnote" uiForeground="secondary">
              {{ t('landing.services.from') }}
              <span class="cr-services__price">{{
                content.price(servicePriceFrom(service()))
              }}</span>
            </span>
            @if (service().variants.length > 0) {
              <span
                uiText
                uiFont="caption"
                uiForeground="secondary"
                class="cr-services__variants"
              >
                <ui-icon uiName="service.variants" />
                {{ service().variants.length }}
              </span>
            }
          </span>
        </span>
      </button>
    </ng-container>
  `,
  // Unscoped so the zoom embellishment can reach ui-async-image's inner
  // <img> (a ViewEncapsulation.None child never carries this component's
  // _ngcontent marker); the .cr-services__ prefix keeps selectors unique.
  encapsulation: ViewEncapsulation.None,
  styles: `
    cr-service-tile {
      /* Tile width is the carousel's intrinsic rhythm (peek layout). */
      display: block;
      inline-size: 9.375rem;
    }

    .cr-services__tile {
      display: flex;
      inline-size: 100%;
      flex-direction: column;
      text-align: start;
      padding: 0;
      border: 0;
      background: none;
      color: var(--sys-color-foreground);
    }

    .cr-services__media {
      position: relative;
      display: block;
      inline-size: 100%;
    }

    .cr-services__image {
      inline-size: 100%;
      background: var(--landing-muted);
    }

    /* The one signature embellishment riding the shared state layer:
       the cover zooms inside its clipped frame. The opacity track mirrors
       ui-async-image's own load fade so both transitions survive the
       shorthand. */
    .cr-services__image .ui-async-image__image {
      transition:
        opacity var(--sys-motion-duration-regular)
          var(--sys-motion-ease-standard),
        transform var(--sys-motion-duration-slow)
          var(--sys-motion-ease-standard);
    }
    @media (hover: hover) {
      .cr-services__tile:hover .ui-async-image__image {
        transform: scale(1.04);
      }
    }

    .cr-services__fallback {
      display: flex;
      inline-size: 100%;
      block-size: 100%;
      align-items: center;
      justify-content: center;
      background: linear-gradient(
        to bottom right,
        var(--landing-muted),
        var(--sys-color-surface-secondary)
      );
      color: var(--landing-muted-foreground);
    }

    .cr-services__fallback-glyph {
      font-size: 2.25rem;
    }

    /* Bundle tell — floating brand chip on the photo corner.
       Deliberately NOT ui-badge/ui-chip: an icon-only 28px elevated disc
       floating over a photo (solid surface + shadow), not a tinted text
       capsule and not interactive — only the DS tokens are shared. */
    .cr-services__bundle-chip {
      position: absolute;
      inset-block-start: var(--sys-space-compact);
      inset-inline-end: var(--sys-space-compact);
      z-index: 20;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      inline-size: 28px;
      block-size: 28px;
      border-radius: var(--control-radius-capsule);
      background: var(--sys-color-surface);
      box-shadow: var(--sys-elevation-raised);
      color: var(--sys-color-accent);
    }

    .cr-services__bundle-glyph {
      font-size: 12px;
    }

    .cr-services__copy {
      display: block;
      margin-block-start: var(--sys-space-compact);
      padding-inline: 2px;
    }

    .cr-services__name {
      display: -webkit-box;
      -webkit-box-orient: vertical;
      -webkit-line-clamp: 2;
      line-clamp: 2;
      overflow: hidden;
    }

    .cr-services__meta {
      display: flex;
      align-items: center;
      gap: var(--sys-space-compact);
      margin-block-start: var(--sys-space-tight);
    }

    .cr-services__price {
      font-variant-numeric: tabular-nums;
    }

    .cr-services__variants {
      display: inline-flex;
      align-items: center;
      gap: 2px;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ServiceTileComponent {
  readonly service = input.required<ServiceVm>();
  readonly pressed = output();

  protected readonly content = inject(LandingContentService);
  protected readonly servicePriceFrom = servicePriceFrom;
}
