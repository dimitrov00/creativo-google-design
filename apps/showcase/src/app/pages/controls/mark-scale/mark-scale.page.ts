import {
  ChangeDetectionStrategy,
  Component,
  computed,
  signal,
} from '@angular/core';
import type { UiMark } from '@creativo/ui/controls';
import {
  UiGauge,
  UiMarkScale,
  UiSlider,
  visibleMarks,
} from '@creativo/ui/controls';
import { UiStack } from '@creativo/ui/layout';
import { UiTextDirective } from '@creativo/ui/modifiers';
import { ScDemo } from '@showcase/shared/demo';
import { ScPage } from '@showcase/shared/page';

@Component({
  selector: 'cr-mark-scale-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ScDemo,
    ScPage,
    UiGauge,
    UiMarkScale,
    UiSlider,
    UiStack,
    UiTextDirective,
  ],
  templateUrl: './mark-scale.page.html',
  styleUrl: './mark-scale.page.css',
})
export class MarkScalePage {
  /** The rewards catalogue: what the points buy, at what cost. */
  protected readonly catalogue: readonly UiMark[] = [
    { value: 120, label: '120 т.', detail: ['Брада'] },
    { value: 250, label: '250 т.', detail: ['Подстригване'] },
    { value: 400, label: '400 т.', detail: ['Продукт'] },
  ];

  /** Words at both ends and the middle: the ends hug the track. */
  protected readonly ends: readonly UiMark[] = [
    { value: 0, label: '0,00 €' },
    { value: 14, label: 'половината' },
    { value: 28, label: '28,00 €' },
  ];

  /** A crowded scale: thresholds too close to all be written. */
  protected readonly crowded: readonly UiMark[] = [
    0, 5, 10, 20, 35, 40, 60, 90, 100,
  ].map((value) => ({ value, label: `${value}` }));

  /** The gap in hundredths, driven by the slider. */
  protected readonly gapPercent = signal(12);
  protected readonly gap = computed(() => this.gapPercent() / 100);
  protected readonly shownCount = computed(
    () => visibleMarks(this.crowded, 0, 100, this.gap()).length,
  );
}
