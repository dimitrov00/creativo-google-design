import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { TranslocoDirective } from '@jsverse/transloco';
import { UiRevealDirective, UiTextDirective } from '@creativo/ui/modifiers';
import { UiScrollRow, UiStack } from '@creativo/ui/layout';
import { UiSectionHeader } from '@creativo/ui/patterns';
import { LandingContentService } from '../../content/landing-content.service';
import { type ServiceVm } from '../../content/landing-content';

import { ServiceTileComponent } from './service-tile.component';
import { CatalogNavigationService } from '../../shared/catalog-navigation.service';

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
  private readonly catalog = inject(CatalogNavigationService);

  /** A tile opens the page's shared detail sheet on that service. */
  protected open(service: ServiceVm): void {
    this.catalog.open(service);
  }
}
