import {
  ChangeDetectionStrategy,
  Component,
  computed,
  signal,
} from '@angular/core';
import { UiAmountField, UiSlider } from '@creativo/ui/controls';
import type { UiSliderMark } from '@creativo/ui/controls';
import { UiStack } from '@creativo/ui/layout';
import { UiTextDirective } from '@creativo/ui/modifiers';
import { ScDemo } from '../../../shared/demo';
import { ScPage } from '../../../shared/page';

@Component({
  selector: 'cr-slider-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ScDemo, ScPage, UiAmountField, UiSlider, UiStack, UiTextDirective],
  templateUrl: './slider.page.html',
  styleUrl: './slider.page.css',
})
export class SliderPage {
  protected readonly percent = signal(15);
  protected readonly bill = 2800;
  protected readonly percentMarks: readonly UiSliderMark[] = [
    0, 25, 50, 75, 100,
  ].map((value) => ({ value, label: `${value}%` }));
  protected readonly off = computed(() =>
    ((this.bill * this.percent()) / 100 / 100).toFixed(2).replace('.', ','),
  );
  protected readonly plain = signal(40);
}
