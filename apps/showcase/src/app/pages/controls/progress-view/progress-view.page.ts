import { ChangeDetectionStrategy, Component } from '@angular/core';
import type { UiControlSize } from '@creativo/ui/controls';
import { UiButton, UiProgressView } from '@creativo/ui/controls';
import { UiFlow, UiStack } from '@creativo/ui/layout';
import { UiTextDirective } from '@creativo/ui/modifiers';
import { ScDemo } from '../../../shared/demo';
import { ScPage } from '../../../shared/page';

@Component({
  selector: 'cr-progress-view-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ScDemo,
    ScPage,
    UiButton,
    UiFlow,
    UiProgressView,
    UiStack,
    UiTextDirective,
  ],
  templateUrl: './progress-view.page.html',
  styleUrl: './progress-view.page.css',
})
export class ProgressViewPage {
  protected readonly sizes: UiControlSize[] = ['small', 'regular', 'large'];
}
