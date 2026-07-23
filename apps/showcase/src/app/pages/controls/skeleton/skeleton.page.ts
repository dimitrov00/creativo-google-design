import { ChangeDetectionStrategy, Component } from '@angular/core';
import type { UiSkeletonAnimation } from '@creativo/ui/controls';
import { UiSkeleton } from '@creativo/ui/controls';
import { UiFlow, UiStack } from '@creativo/ui/layout';
import type { UiRadiusScale } from '@creativo/ui/modifiers';
import { UiFrameDirective, UiTextDirective } from '@creativo/ui/modifiers';
import { ScDemo } from '../../../shared/demo';
import { ScPage } from '../../../shared/page';

interface SkeletonShapeSample {
  /** What the placeholder stands in for. */
  readonly name: string;
  readonly width: string;
  readonly height: string;
  readonly radius: UiRadiusScale;
}

@Component({
  selector: 'cr-skeleton-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ScDemo,
    ScPage,
    UiFlow,
    UiFrameDirective,
    UiSkeleton,
    UiStack,
    UiTextDirective,
  ],
  templateUrl: './skeleton.page.html',
  styleUrl: './skeleton.page.css',
})
export class SkeletonPage {
  protected readonly radii: UiRadiusScale[] = [
    'subtle',
    'regular',
    'prominent',
    'hero',
    'capsule',
  ];

  protected readonly animations: UiSkeletonAnimation[] = [
    'shimmer',
    'pulse',
    'none',
  ];

  /** Placeholder geometry for common content roles — sized via uiFrame. */
  protected readonly shapes: SkeletonShapeSample[] = [
    { name: 'text line', width: '240px', height: '16px', radius: 'subtle' },
    { name: 'avatar', width: '56px', height: '56px', radius: 'capsule' },
    { name: 'thumbnail', width: '120px', height: '80px', radius: 'regular' },
    { name: 'card', width: '220px', height: '120px', radius: 'prominent' },
  ];
}
