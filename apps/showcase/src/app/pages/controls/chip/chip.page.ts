import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { UiControlSize } from '@creativo/ui/controls';
import { UiChip, UiStack } from '@creativo/ui/controls';
import { UiTextDirective } from '@creativo/ui/modifiers';

@Component({
  selector: 'cr-chip-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, UiChip, UiStack, UiTextDirective],
  templateUrl: './chip.page.html',
  styleUrl: './chip.page.css',
})
export class ChipPage {
  protected readonly sizes: UiControlSize[] = [
    'compact',
    'regular',
    'prominent',
  ];
  protected readonly selectedStates = [false, true];
}
