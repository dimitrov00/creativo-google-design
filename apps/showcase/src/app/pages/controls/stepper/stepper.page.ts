import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { UiButton } from '@creativo/ui/controls';
import { UiStack } from '@creativo/ui/layout';
import { UiStepper } from '@creativo/ui/patterns';
import { UiFrameDirective, UiTextDirective } from '@creativo/ui/modifiers';
import { ScDemo } from '../../../shared/demo';
import { ScPage } from '../../../shared/page';

@Component({
  selector: 'cr-stepper-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ScDemo,
    ScPage,
    UiButton,
    UiFrameDirective,
    UiStack,
    UiStepper,
    UiTextDirective,
  ],
  templateUrl: './stepper.page.html',
  styleUrl: './stepper.page.css',
})
export class StepperPage {
  /** Live demo — step through the journey and watch the segments glide. */
  protected readonly current = signal(1);

  protected advance(): void {
    this.current.update((step) => (step >= 3 ? 1 : step + 1));
  }
}
