import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TranslocoDirective } from '@jsverse/transloco';
import { UiStack } from '@creativo/ui/layout';
import { UiRevealDirective } from '@creativo/ui/modifiers';
import { UiSectionHeader } from '@creativo/ui/patterns';
import { BookingCtaComponent } from '../../shared/cta/booking-cta.component';

/**
 * The closing — Apple-hero register (design call): plain background, a
 * centered headline, one supporting paragraph, and a single capsule CTA.
 * No band, no oversized art direction. The CTA is the shared
 * cr-booking-cta, so the page opens (hero) and closes on the same chord.
 */
@Component({
  selector: 'cr-closing-cta',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    BookingCtaComponent,
    TranslocoDirective,
    UiRevealDirective,
    UiSectionHeader,
    UiStack,
  ],
  host: { class: 'cr-closing', 'data-testid': 'landing-closing-cta' },
  template: `
    <ng-container *transloco="let t">
      <ui-stack uiGap="loose" uiAlign="center">
        <ui-section-header uiAlign="center">
          <h2 uiReveal uiTitle>
            {{ t('landing.closing.heading') }}
          </h2>
          <p uiReveal [uiRevealDelay]="80" uiLede>
            {{ t('landing.closing.subtitle') }}
          </p>
        </ui-section-header>
        <cr-booking-cta
          uiReveal
          [uiRevealDelay]="160"
          labelKey="landing.closing.cta"
          testId="landing-closing-link"
        />
      </ui-stack>
    </ng-container>
  `,
  styles: `
    /* Type metrics and measures come from ui-section-header; the CTA tier
       from cr-booking-cta. Only the section's block rhythm lives here,
       derived from the shared section step (7rem, density-aware). */
    :host {
      display: block;
      padding: var(--sys-space-section) var(--landing-gutter)
        calc(var(--sys-space-section) - var(--sys-space-regular));
    }
    @media (min-width: 640px) {
      :host {
        padding-block-start: calc(
          var(--sys-space-section) + var(--sys-space-spacious)
        );
      }
    }
  `,
})
export class ClosingCtaComponent {}
