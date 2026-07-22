import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslocoDirective } from '@jsverse/transloco';
import { UiButton } from '@creativo/ui/controls';
import { UiSectionHeader } from '@creativo/ui/patterns';
import { FadeUpDirective } from '../../shared/motion/fade-up.directive';

/**
 * The closing — Apple-hero register (design call): plain background, a
 * centered headline, one supporting paragraph, and a single capsule CTA.
 * No band, no oversized art direction.
 */
@Component({
  selector: 'cr-closing-cta',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FadeUpDirective,
    RouterLink,
    TranslocoDirective,
    UiButton,
    UiSectionHeader,
  ],
  host: { class: 'cr-closing', 'data-testid': 'landing-closing-cta' },
  template: `
    <ng-container *transloco="let t">
      <ui-section-header uiAlign="center">
        <h2 crFadeUp uiTitle class="cr-closing__heading">
          {{ t('landing.closing.heading') }}
        </h2>
        <p crFadeUp [crFadeUpDelay]="0.08" uiLede class="cr-closing__subtitle">
          {{ t('landing.closing.subtitle') }}
        </p>
      </ui-section-header>
      <div crFadeUp [crFadeUpDelay]="0.16" class="cr-closing__actions">
        <a
          routerLink="/auth"
          [queryParams]="{ redirect: '/book' }"
          uiButton
          uiVariant="prominent"
          uiSize="regular"
          uiShape="capsule"
          class="cr-closing__button"
          data-testid="landing-closing-link"
        >
          {{ t('landing.closing.cta') }}
        </a>
      </div>
    </ng-container>
  `,
  styles: `
    :host {
      display: block;
      padding: 8rem var(--landing-gutter) 6rem;
      text-align: center;
    }
    @media (min-width: 640px) {
      :host {
        padding-block-start: 10rem;
      }
    }
    /* Type metrics come from ui-section-header — only measures stay here. */
    .cr-closing__heading {
      max-inline-size: 25rem;
    }
    .cr-closing__subtitle {
      max-inline-size: 24rem;
    }
    .cr-closing__actions {
      margin-block-start: 2rem;
    }
    .cr-closing__button {
      padding-inline: 2rem;
    }
  `,
})
export class ClosingCtaComponent {}
