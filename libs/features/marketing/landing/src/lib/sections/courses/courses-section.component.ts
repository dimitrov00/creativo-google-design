import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslocoDirective } from '@jsverse/transloco';
import { UiButton, UiIcon } from '@creativo/ui/controls';
import { UiOverlayDirective, UiRevealDirective } from '@creativo/ui/modifiers';
import { UiSectionHeader } from '@creativo/ui/patterns';

/**
 * Barber courses teaser — an evergreen invite, still no per-course cards
 * or inline enrollment flow here (same restraint as `cr-hiring-section`).
 * The CTA now routes to `/courses`, the live open/upcoming catalog page,
 * rather than linking straight out to Instagram — what's actually open
 * still runs hot/cold, but that page's own empty state handles "nothing
 * open right now" instead of this evergreen section pretending otherwise.
 */
@Component({
  selector: 'cr-courses-section',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    TranslocoDirective,
    UiButton,
    UiIcon,
    UiOverlayDirective,
    UiRevealDirective,
    UiSectionHeader,
  ],
  templateUrl: './courses-section.component.html',
  styleUrl: './courses-section.component.css',
  host: { class: 'cr-courses', 'data-testid': 'landing-courses' },
})
export class CoursesSectionComponent {}
