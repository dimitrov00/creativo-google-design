import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { UiSkeletonAnimation } from '@creativo/ui/controls';
import { UiSkeleton, UiStack } from '@creativo/ui/controls';
import type { UiRadiusScale } from '@creativo/ui/modifiers';
import { UiTextDirective } from '@creativo/ui/modifiers';

@Component({
  selector: 'cr-skeleton-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, UiSkeleton, UiStack, UiTextDirective],
  templateUrl: './skeleton.page.html',
  styleUrl: './skeleton.page.css',
})
export class SkeletonPage {
  protected readonly animations: UiSkeletonAnimation[] = [
    'shimmer',
    'pulse',
    'none',
  ];
  protected readonly radii: UiRadiusScale[] = [
    'subtle',
    'regular',
    'prominent',
    'capsule',
  ];
}
