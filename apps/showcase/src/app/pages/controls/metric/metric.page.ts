import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import type { UiMetricTrend } from '@creativo/ui/controls';
import { UiButton, UiCard, UiGauge, UiMetric } from '@creativo/ui/controls';
import { UiFlow, UiGrid, UiStack } from '@creativo/ui/layout';
import { UiTextDirective } from '@creativo/ui/modifiers';
import { ScDemo } from '@showcase/shared/demo';
import { ScPage } from '@showcase/shared/page';

/** Whole points in the page's locale — the owner formats, never the metric. */
const points = new Intl.NumberFormat('bg-BG', { maximumFractionDigits: 0 });

@Component({
  selector: 'cr-metric-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ScDemo,
    ScPage,
    UiButton,
    UiCard,
    UiFlow,
    UiGauge,
    UiGrid,
    UiMetric,
    UiStack,
    UiTextDirective,
  ],
  templateUrl: './metric.page.html',
  styleUrl: './metric.page.css',
})
export class MetricPage {
  /** The live-change demo: a balance that moves while the page is open. */
  protected readonly balance = signal(308);
  protected readonly delta = signal<string | null>(null);
  protected readonly trend = signal<UiMetricTrend | null>(null);

  protected formatted(value: number): string {
    return points.format(value);
  }

  protected earn(amount: number): void {
    this.balance.update((value) => value + amount);
    this.delta.set(`+${amount}`);
    this.trend.set('up');
  }

  protected spend(amount: number): void {
    this.balance.update((value) => value - amount);
    this.delta.set(`−${amount}`);
    this.trend.set('down');
  }

  /** Each replay keys a fresh metric, so the count-up plays again. */
  protected readonly countUpRun = signal(0);
}
