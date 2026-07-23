import { ChangeDetectionStrategy, Component } from '@angular/core';
import { UiAsyncImage, UiIcon } from '@creativo/ui/controls';
import { UiFlow, UiStack } from '@creativo/ui/layout';
import {
  UiFrameDirective,
  UiRadiusDirective,
  UiTextDirective,
} from '@creativo/ui/modifiers';
import { ScDemo } from '../../../shared/demo';
import { ScPage } from '../../../shared/page';

@Component({
  selector: 'cr-async-image-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ScDemo,
    ScPage,
    UiAsyncImage,
    UiFlow,
    UiFrameDirective,
    UiIcon,
    UiRadiusDirective,
    UiStack,
    UiTextDirective,
  ],
  templateUrl: './async-image.page.html',
  styleUrl: './async-image.page.css',
})
export class AsyncImagePage {
  protected readonly loadedSrc =
    'https://images.unsplash.com/photo-1560066984-138dadb4c035?w=640&h=480&fit=crop';
  /** Guaranteed 404 — the error state keeps the placeholder up. */
  protected readonly brokenSrc = '/missing/salon-interior.jpg';
}
