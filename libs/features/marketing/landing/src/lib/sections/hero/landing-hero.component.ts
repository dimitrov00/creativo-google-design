import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TranslocoDirective } from '@jsverse/transloco';
import { UiAmbientVideo } from '@creativo/ui/controls';
import { UiSpacer, UiStack } from '@creativo/ui/layout';
import {
  UiOverlayDirective,
  UiPaddingDirective,
  UiRadiusDirective,
  UiRevealDirective,
} from '@creativo/ui/modifiers';
import { UiSectionHeader } from '@creativo/ui/patterns';
import { BookingCtaComponent } from '../../shared/cta/booking-cta.component';
import { LocaleThemeToggleComponent } from '@creativo/features/marketing/shell';

/**
 * Inset hero — closing-CTA register (case study §3): a rounded B&W video
 * card (squircle, hero radius) filling the viewport column, a centered
 * title/paragraph pair mid-card, the capsule booking CTA under the card on
 * the page background, and the locale/theme toggles on a bottom overlay row
 * inside the media. The fixed LandingHeader owns the wordmark; the hero
 * carries no top bar of its own.
 *
 * All behavior lives in the DS primitives: ui-ambient-video owns the
 * poster/reduced-motion/crossfade contract, uiReveal owns the staged mount
 * entrance (elements inside `*transloco` render only after the async
 * translation load, so mount reveals fire exactly once the copy exists —
 * no rAF retry sweep needed).
 */
@Component({
  selector: 'cr-landing-hero',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    BookingCtaComponent,
    LocaleThemeToggleComponent,
    TranslocoDirective,
    UiAmbientVideo,
    UiOverlayDirective,
    UiPaddingDirective,
    UiRadiusDirective,
    UiRevealDirective,
    UiSectionHeader,
    UiSpacer,
    UiStack,
  ],
  templateUrl: './landing-hero.component.html',
  styleUrl: './landing-hero.component.css',
  host: { class: 'cr-hero', 'data-testid': 'landing-hero' },
})
export class LandingHeroComponent {}
