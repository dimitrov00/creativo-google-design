import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import type { UiControlSize } from '@creativo/ui/controls';
import { UiChip } from '@creativo/ui/controls';
import { UiFlow, UiStack } from '@creativo/ui/layout';
import { UiTextDirective } from '@creativo/ui/modifiers';
import { UiAvatar, UiIcon } from '@creativo/ui/controls';
import { ScDemo } from '../../../shared/demo';
import { ScPage } from '../../../shared/page';

@Component({
  selector: 'cr-chip-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ScDemo,
    ScPage,
    UiAvatar,
    UiChip,
    UiFlow,
    UiIcon,
    UiStack,
    UiTextDirective,
  ],
  templateUrl: './chip.page.html',
  styleUrl: './chip.page.css',
})
export class ChipPage {
  protected readonly sizes: UiControlSize[] = ['small', 'regular', 'large'];
  protected readonly selectedStates = [false, true];

  /** Live filter row — one selection Set, toggled per chip. */
  protected readonly filters = ['Balayage', 'Blowout', 'Color', 'Spa day'];
  protected readonly selection = signal<ReadonlySet<string>>(
    new Set(['Color']),
  );

  protected isSelected(filter: string): boolean {
    return this.selection().has(filter);
  }

  protected toggle(filter: string): void {
    this.selection.update((previous) => {
      const next = new Set(previous);
      if (next.has(filter)) {
        next.delete(filter);
      } else {
        next.add(filter);
      }
      return next;
    });
  }
}
