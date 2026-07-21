import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { UiControlSize } from '@creativo/ui/controls';
import { UiInput, UiStack } from '@creativo/ui/controls';
import { UiTextDirective } from '@creativo/ui/modifiers';

@Component({
  selector: 'cr-input-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, UiInput, UiStack, UiTextDirective],
  templateUrl: './input.page.html',
  styleUrl: './input.page.css',
})
export class InputPage {
  protected readonly sizes: UiControlSize[] = [
    'compact',
    'regular',
    'prominent',
  ];
  protected readonly invalidStates = [false, true];
}
