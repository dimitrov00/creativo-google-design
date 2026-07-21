import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { UiControlSize } from '@creativo/ui/controls';
import { UiSpinner, UiStack } from '@creativo/ui/controls';
import { UiTextDirective } from '@creativo/ui/modifiers';

@Component({
  selector: 'cr-spinner-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, UiSpinner, UiStack, UiTextDirective],
  templateUrl: './spinner.page.html',
  styleUrl: './spinner.page.css',
})
export class SpinnerPage {
  protected readonly sizes: UiControlSize[] = [
    'compact',
    'regular',
    'prominent',
  ];
}
