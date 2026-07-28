import {
  ChangeDetectionStrategy,
  Component,
  ViewEncapsulation,
  input,
  output,
} from '@angular/core';
import { UiAsyncImage, UiButton, UiIcon } from '@creativo/ui/controls';
import {
  UiInteractiveDirective,
  UiRadiusDirective,
  UiTextDirective,
} from '@creativo/ui/modifiers';

/**
 * One selectable cover-art service card for the onboarding grid —
 * image-forward (Revolut-card language): the 4/5 cover IS the surface, a
 * bottom scrim carries the inset name + duration·price meta, a circular
 * chip top-right states selection (empty ring → accent check), and the
 * quiet white info pill top-left opens the details sheet without stealing
 * the card's main job (tap anywhere = toggle).
 *
 * Two sibling buttons, never nested (invalid HTML): the full-bleed select
 * button and the small info pill floated above it. At the cap, unselected
 * cards dim + disable (`capBlocked`) — deselecting elsewhere re-arms them;
 * the info pill stays live so details remain reachable.
 */
@Component({
  selector: 'lib-onboarding-service-card',
  imports: [
    UiAsyncImage,
    UiButton,
    UiIcon,
    UiInteractiveDirective,
    UiRadiusDirective,
    UiTextDirective,
  ],
  template: `
    <button
      type="button"
      class="onboarding-service-card__select"
      uiInteractive
      uiRadius="prominent"
      [disabled]="capBlocked()"
      [attr.aria-pressed]="selected()"
      [attr.data-testid]="'onboarding-service-' + serviceId()"
      (click)="toggled.emit()"
    >
      <ui-async-image
        class="onboarding-service-card__media"
        [uiSrc]="coverUrl()"
        [uiAlt]="''"
        uiRatio="1 / 1"
        [uiRing]="true"
        uiRadius="prominent"
      >
        <span uiPlaceholder class="onboarding-service-card__fallback">
          <ui-icon
            uiName="service.placeholder"
            class="onboarding-service-card__fallback-glyph"
          />
        </span>
      </ui-async-image>

      <span class="onboarding-service-card__scrim" aria-hidden="true"></span>

      <span class="onboarding-service-card__copy">
        <span uiText uiFont="callout" uiWeight="bold">{{ name() }}</span>
        <span uiText uiFont="caption" class="onboarding-service-card__meta">{{
          meta()
        }}</span>
      </span>

      <span
        class="onboarding-service-card__check"
        [attr.data-selected]="selected() ? '' : null"
        aria-hidden="true"
      >
        <ui-icon uiName="checklist.done" />
      </span>
    </button>

    <button
      type="button"
      uiButton
      uiButtonStyle="bordered"
      uiTint="neutral"
      [uiOnMedia]="true"
      uiButtonBorderShape="capsule"
      uiControlSize="small"
      [uiIconOnly]="true"
      class="onboarding-service-card__info"
      [attr.aria-label]="detailsLabel()"
      [attr.data-testid]="'onboarding-service-info-' + serviceId()"
      (click)="details.emit()"
    >
      <ui-icon uiName="service.details" uiScale="small" />
    </button>
  `,
  styleUrl: './onboarding-service-card.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Unscoped: bare `.onboarding-*` selectors never match a component's own
  // HOST element under emulated encapsulation (see avatar.ts) — and the
  // host rule below (`position: relative`) anchors the floating pills.
  encapsulation: ViewEncapsulation.None,
  host: {
    class: 'onboarding-service-card',
    '[attr.data-selected]': "selected() ? '' : null",
    '[attr.data-cap-blocked]': "capBlocked() ? '' : null",
  },
})
export class OnboardingServiceCard {
  readonly serviceId = input.required<string>();
  readonly name = input.required<string>();
  /** Pre-formatted "45 мин · 30 лв." line — locale work stays with the parent. */
  readonly meta = input.required<string>();
  readonly coverUrl = input<string | null>(null);
  readonly selected = input(false);
  /** True when the cap is reached and this card is NOT selected — dimmed + inert. */
  readonly capBlocked = input(false);
  readonly detailsLabel = input.required<string>();

  readonly toggled = output<void>();
  readonly details = output<void>();
}
