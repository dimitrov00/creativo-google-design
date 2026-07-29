import {
  ChangeDetectionStrategy,
  Component,
  ViewEncapsulation,
  inject,
  input,
  output,
} from '@angular/core';
import { TranslocoDirective } from '@jsverse/transloco';
import { UiIcon, UiMediaCard } from '@creativo/ui/controls';
import { UiStack } from '@creativo/ui/layout';
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
 * bundles shelves. The card IS `ui-media-card` (the same cover-art surface
 * the onboarding picker reads in — owner ruling 2026-07-28: one service
 * card, one register): cover art with the sanctioned media scrim and the
 * name/price caption inset over the picture, plus the bundle tell in the
 * trailing corner slot. The landing card carries no selection chip and no
 * info pill — the whole tile IS the details affordance here.
 *
 * Hover/press feedback is the shared `[data-interactive]` grammar; the
 * image zoom is this tile's one signature embellishment.
 */
@Component({
  selector: 'cr-service-tile',
  imports: [
    TranslocoDirective,
    UiIcon,
    UiInteractiveDirective,
    UiMediaCard,
    UiRadiusDirective,
    UiStack,
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
        <ui-media-card
          class="cr-services__card"
          uiRadius="prominent"
          uiRatio="4 / 5"
          [uiSrc]="service().coverSrc ?? null"
        >
          <!-- Graceful degradation — a styled scissors motif reads as
               intentional, never broken (v2 imageFallback). -->
          <span uiPlaceholder class="cr-services__fallback">
            <ui-icon
              uiName="service.placeholder"
              class="cr-services__fallback-glyph"
            />
          </span>

          <!-- Caption rhythm is the media card's own (both lines project
               into its inset stack) — no local copy wrapper. -->
          <span
            uiCaption
            uiText
            uiFont="callout"
            uiWeight="bold"
            class="cr-services__name"
            >{{ content.text(service().name) }}</span
          >
          <ui-stack
            uiCaption
            uiAxis="horizontal"
            uiAlignment="center"
            uiSpacing="compact"
          >
            <span uiText uiFont="footnote" uiForegroundStyle="secondary">
              {{ t('landing.services.from') }}
              <span class="cr-services__price">{{
                content.price(servicePriceFrom(service()))
              }}</span>
            </span>
            @if (service().variants.length > 0) {
              <span
                uiText
                uiFont="footnote"
                uiForegroundStyle="secondary"
                class="cr-services__variants"
              >
                <ui-icon uiName="service.variants" />
                {{ service().variants.length }}
              </span>
            }
          </ui-stack>

          @if (service().kind === 'bundle') {
            <span
              uiOverlayTrailing
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
        </ui-media-card>
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

    /* Button reset only — the card surface is ui-media-card. */
    .cr-services__tile {
      display: block;
      inline-size: 100%;
      text-align: start;
      padding: 0;
      border: 0;
      background: none;
      color: var(--sys-color-foreground);
    }

    .cr-services__card {
      background: var(--landing-muted);
    }

    /* The one signature embellishment riding the shared state layer:
       the cover zooms inside its clipped frame. The opacity track mirrors
       ui-async-image's own load fade so both transitions survive the
       shorthand. */
    .cr-services__card .ui-async-image__image {
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
    /* Ungated press mirror — a hover-only embellishment is invisible on
       phones (owner ruling: every hover effect needs its :active twin). */
    .cr-services__tile:active .ui-async-image__image {
      transform: scale(1.04);
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
      /* KEPT: placeholder ART, not a control glyph — the oversized mark
         fills the empty media box; the 16/20/24 control ladder doesn't
         apply to media-canvas illustration. */
      font-size: 2.25rem;
    }

    /* Bundle tell — floating brand chip in the card's trailing corner
       slot (ui-media-card positions it; only the chrome is local).
       Deliberately NOT ui-badge/ui-chip: an icon-only elevated disc
       floating over a photo (solid surface + shadow), not a tinted text
       capsule and not interactive — only the DS tokens are shared. Size
       is a space-unit multiple, one step under the 36px control tier. */
    .cr-services__bundle-chip {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      inline-size: calc(var(--sys-space-unit) * 7);
      block-size: calc(var(--sys-space-unit) * 7);
      border-radius: var(--control-radius-capsule);
      background: var(--sys-color-surface);
      box-shadow: var(--sys-elevation-raised);
      color: var(--sys-color-accent);
    }

    .cr-services__bundle-glyph {
      /* Small rung of the fixed icon ladder — the disc is one step under
         the 36px control tier, so its glyph takes the step under 20. */
      font-size: var(--ui-icon-small);
    }

    .cr-services__name {
      display: -webkit-box;
      -webkit-box-orient: vertical;
      -webkit-line-clamp: 2;
      line-clamp: 2;
      overflow: hidden;
    }

    .cr-services__price {
      font-variant-numeric: tabular-nums;
    }

    .cr-services__variants {
      display: inline-flex;
      align-items: center;
      /* KEPT: glyph-to-count KERNING (typographic, sub-rung) — not a
         layout gap. */
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
