import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslocoDirective } from '@jsverse/transloco';
import { UiButton } from '@creativo/ui/controls';
import { FadeUpDirective } from '../../shared/motion/fade-up.directive';

/**
 * The closing — Apple-hero register (design call): plain background, a
 * centered headline, one supporting paragraph, and a single capsule CTA.
 * No band, no oversized art direction.
 */
@Component({
  selector: 'cr-closing-cta',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FadeUpDirective, RouterLink, TranslocoDirective, UiButton],
  host: { class: 'cr-closing', 'data-testid': 'landing-closing-cta' },
  template: `
    <ng-container *transloco="let t">
      <h2 crFadeUp class="cr-closing__heading">
        {{ t('landing.closing.heading') }}
      </h2>
      <p crFadeUp [crFadeUpDelay]="0.08" class="cr-closing__subtitle">
        {{ t('landing.closing.subtitle') }}
      </p>
      <div crFadeUp [crFadeUpDelay]="0.16" class="cr-closing__actions">
        <a
          routerLink="/auth"
          [queryParams]="{ redirect: '/book' }"
          class="cr-closing__link"
          data-testid="landing-closing-link"
        >
          <button
            uiButton
            uiVariant="prominent"
            uiSize="regular"
            uiShape="capsule"
            class="cr-closing__button"
            tabindex="-1"
          >
            {{ t('landing.closing.cta') }}
          </button>
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
    .cr-closing__heading {
      margin: 0 auto;
      max-inline-size: 25rem;
      font: var(--sys-font-extraLargeTitle);
      letter-spacing: var(--sys-tracking-largeTitle);
      color: var(--sys-color-foreground);
    }
    .cr-closing__subtitle {
      margin: 1rem auto 0;
      max-inline-size: 24rem;
      font: var(--sys-font-body);
      color: var(--landing-muted-foreground);
    }
    .cr-closing__actions {
      margin-block-start: 2rem;
    }
    .cr-closing__link {
      display: inline-block;
      text-decoration: none;
    }
    .cr-closing__button {
      padding-inline: 2rem;
      pointer-events: none;
    }
  `,
})
export class ClosingCtaComponent {}
