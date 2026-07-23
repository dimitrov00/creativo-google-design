import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TranslocoDirective } from '@jsverse/transloco';
import { UiAmbientVideo } from '@creativo/ui/controls';
import { UiStack } from '@creativo/ui/layout';
import {
  UiOverlayDirective,
  UiRadiusDirective,
  UiRevealDirective,
} from '@creativo/ui/modifiers';
import { UiSectionHeader } from '@creativo/ui/patterns';
import { BookingCtaComponent } from '../../shared/cta/booking-cta.component';
import { LocaleThemeToggleComponent } from '../../shared/prefs/locale-theme-toggle.component';

/**
 * Inset hero — closing-CTA register (case study §3): a rounded B&W video
 * card (squircle, hero radius) filling the viewport column, a centered
 * title/paragraph/capsule-CTA trio mid-card, and the locale/theme toggles
 * on a bottom overlay row inside the media. The fixed LandingHeader owns
 * the wordmark; the hero carries no top bar of its own.
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
    UiRadiusDirective,
    UiRevealDirective,
    UiSectionHeader,
    UiStack,
  ],
  templateUrl: './landing-hero.component.html',
  styleUrl: './landing-hero.component.css',
  host: { class: 'cr-hero', 'data-testid': 'landing-hero' },
})
export class LandingHeroComponent {}
