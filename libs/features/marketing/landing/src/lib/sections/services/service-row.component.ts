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
import { UiStack } from '@creativo/ui/layout';
import {
  UiForegroundStyleDirective,
  UiInteractiveDirective,
  UiRadiusDirective,
  UiTextDirective,
} from '@creativo/ui/modifiers';
import { UiListRow } from '@creativo/ui/patterns';
import { LandingContentService } from '../../content/landing-content.service';
import type { ServiceVm } from '../../content/landing-content';

/**
 * One navigable service row — the shape both catalog manifests read in:
 * a bundle's members and a barber's price list. Identical rows on purpose;
 * they are the same fact ("this service, at this price, one tap away") seen
 * from two directions, and rendering them twice would let them drift.
 *
 * HIG subtitle + right-detail row: leading identity thumbnail, the service
 * NAME as the primary label, an optional duration subtitle, and the price
 * as the one trailing value. A native `<button>` so Enter/Space and focus
 * come free — the row carries no nested controls.
 */
@Component({
  selector: 'cr-service-row',
  imports: [
    TranslocoDirective,
    UiAsyncImage,
    UiIcon,
    UiForegroundStyleDirective,
    UiInteractiveDirective,
    UiListRow,
    UiRadiusDirective,
    UiStack,
    UiTextDirective,
  ],
  template: `
    <ng-container *transloco="let t">
      <button
        uiListRow
        type="button"
        role="listitem"
        [uiInteractive]="true"
        class="service-row"
        [attr.data-testid]="'service-row-' + service().id"
        [attr.aria-label]="
          t('landing.services.openService', {
            service: content.text(service().name),
          })
        "
        (click)="pressed.emit()"
      >
        <ui-async-image
          uiLeading
          class="service-row__thumb"
          uiRatio="1 / 1"
          uiRadius="regular"
          [uiRing]="true"
          [uiSrc]="service().coverSrc ?? null"
          [uiAlt]="''"
        >
          <span uiPlaceholder class="service-row__fallback">
            <ui-icon uiName="service.placeholder" />
          </span>
        </ui-async-image>

        <ui-stack uiSpacing="tight" class="service-row__identity">
          <span uiText uiFont="headline" class="service-row__name">{{
            content.text(service().name)
          }}</span>
          <!-- ONE metadata subtitle, dot-separated (the performer-row
               grammar). A bundle is called out HERE rather than with a
               corner chip like the carousel tile: at a 36px thumbnail a
               chip would be an illegible speck, and the subtitle line is
               where a row's qualifying facts already live.

               Glyph AND word, unlike the duration's dropped clock. That
               rule is about a symbol restating its own unit label; this is
               a repeated CATEGORY mark, which is what HIG symbols are for
               — you spot the layers mark down a run without reading it,
               and it's the same pairing the sheet's bundle badge uses. -->
          <ui-stack
            uiAxis="horizontal"
            uiSpacing="tight"
            uiAlignment="center"
            uiText
            uiFont="footnote"
            uiForegroundStyle="secondary"
            class="service-row__meta"
          >
            @if (minutes(); as duration) {
              <span
                >{{ duration }} {{ t('landing.services.durationLabel') }}</span
              >
            }
            @if (service().kind === 'bundle') {
              @if (minutes() !== undefined) {
                <span aria-hidden="true">·</span>
              }
              <span uiForegroundStyle="accent" class="service-row__bundle">
                <ui-icon uiName="service.bundle" />
                {{ t('landing.services.bundle') }}
              </span>
            }
          </ui-stack>
        </ui-stack>

        <!-- No disclosure chevron: the price already occupies the
             trailing edge, and a chevron beside it is a second trailing
             mark saying what the row's own press feedback already says
             (owner ruling). -->
        <span uiTrailing class="service-row__price">{{ price() }}</span>
      </button>
    </ng-container>
  `,
  // Unscoped (landing sheet-section convention for DS-composed internals).
  encapsulation: ViewEncapsulation.None,
  styles: `
    cr-service-row {
      display: contents;
    }

    .service-row__thumb {
      /* One rung under the 52px row tier — an identity thumbnail, not an
         avatar (services are things, not people, so no capsule radius). */
      inline-size: var(--control-size-small);
      flex: 0 0 auto;
    }

    .service-row__fallback {
      display: grid;
      place-items: center;
      inline-size: 100%;
      block-size: 100%;
      background: var(--sys-color-surface);
      color: var(--sys-color-secondary-label);
    }

    .service-row__identity {
      min-inline-size: 0;
    }

    /* The subtitle never wraps or shrinks — the NAME above it is the
       flexible part that gives way to the trailing price. */
    .service-row__meta > * {
      flex: 0 0 auto;
    }

    .service-row__meta:empty {
      display: none;
    }

    /* Glyph rides the subtitle's own font (icon size policy — no local
       em-fractions). KEPT 2px: glyph-to-label KERNING, typographic and
       sub-rung, not a layout gap — the service tile's variant count sets
       the same precedent. */
    .service-row__bundle {
      display: inline-flex;
      align-items: center;
      gap: 2px;
    }

    /* The primary label ellipsizes rather than wrapping — the row keeps a
       fixed rhythm and gives way to the trailing value column. */
    .service-row__name {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    /* The row's ONE trailing value. Full ink (the trailing slot defaults
       to secondary) and tabular figures so prices align down the run. */
    .service-row__price {
      color: var(--sys-color-foreground);
      font-variant-numeric: tabular-nums;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ServiceRowComponent {
  readonly service = input.required<ServiceVm>();
  /** Pre-formatted money — the caller decides whether it's a "from" price
   *  (a bundle member, cheapest across barbers) or one barber's own. */
  readonly price = input.required<string>();
  /** Duration subtitle; omitted where the row's context already states it. */
  readonly minutes = input<number | undefined>(undefined);

  readonly pressed = output<void>();

  protected readonly content = inject(LandingContentService);
}
