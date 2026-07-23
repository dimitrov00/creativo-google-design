import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
} from '@angular/core';
import { TranslocoDirective } from '@jsverse/transloco';
import { UiRevealDirective, UiTextDirective } from '@creativo/ui/modifiers';
import { UiScrollRow, UiStack } from '@creativo/ui/layout';
import { UiSectionHeader } from '@creativo/ui/patterns';
import { LandingContentService } from '../../content/landing-content.service';
import { type ServiceVm } from '../../content/landing-content';
import { ServiceDetailComponent } from './service-detail.component';
import { ServiceTileComponent } from './service-tile.component';

/**
 * The services shelf — v2 `services-section.tsx`: header trio, a swipeable
 * carousel of portrait single-service tiles (next tile peeking past the
 * edge), a titled bundles shelf below, and the read-only detail sheet one
 * tap away. Tiles "deal in" from the right with the staggered house reveal
 * ([uiReveal]) the first time they scroll into view.
 */
@Component({
  selector: 'cr-services-section',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ServiceDetailComponent,
    ServiceTileComponent,
    TranslocoDirective,
    UiRevealDirective,
    UiScrollRow,
    UiSectionHeader,
    UiStack,
    UiTextDirective,
  ],
  templateUrl: './services-section.component.html',
  styleUrl: './services-section.component.css',
  host: { class: 'cr-services', 'data-testid': 'landing-services' },
})
export class ServicesSectionComponent {
  protected readonly content = inject(LandingContentService);

  protected readonly selectedService = signal<ServiceVm | null>(null);

  protected open(service: ServiceVm): void {
    this.selectedService.set(service);
  }
}
