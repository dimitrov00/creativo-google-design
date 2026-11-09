import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { UiSkeleton } from '@creativo/ui/controls';
import { UiSparkBars } from '@creativo/ui/charts';
import {
  UiForegroundStyleDirective,
  UiFrameDirective,
  UiInteractiveDirective,
  UiPaddingDirective,
  UiTextDirective,
  UiWeightDirective,
} from '@creativo/ui/modifiers';
import { UiCard, UiGauge } from '@creativo/ui/patterns';
import type { AnalyticsPageVm } from '../analytics-home.vm';

/**
 * ONE PAGE OF THE CAROUSEL — a period's bento (staff-analytics-v3, «The home
 * screen» 4): the takings card across the width, four half cards under it
 * (working time, tips, rebooked, no-shows) and, on the shop scope, the team
 * across the width. Each card is a word, a figure, a line under it and one
 * tiny graph, and each opens its own screen
 * (`/staff/analytics/<card>?span&from&to&barber`) on this page's period.
 * Without its report the page draws the cards' bones.
 */
@Component({
  selector: 'lib-analytics-bento',
  imports: [
    RouterLink,
    UiCard,
    UiForegroundStyleDirective,
    UiFrameDirective,
    UiGauge,
    UiInteractiveDirective,
    UiPaddingDirective,
    UiSkeleton,
    UiSparkBars,
    UiTextDirective,
    UiWeightDirective,
  ],
  templateUrl: './analytics-bento.html',
  styleUrl: './analytics-bento.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AnalyticsBento {
  readonly page = input.required<AnalyticsPageVm>();
}
