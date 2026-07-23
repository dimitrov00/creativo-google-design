import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { UiButton } from '@creativo/ui/controls';
import type { UiSheetPlacement } from '@creativo/ui/layout';
import { UiFlow, UiSheet, UiStack } from '@creativo/ui/layout';
import { UiTextDirective } from '@creativo/ui/modifiers';
import { ScDemo } from '../../../shared/demo';
import { ScPage } from '../../../shared/page';

/** The three placements plus the wide `.page` set-piece demo. */
type SheetDemoKey = UiSheetPlacement | 'page';

@Component({
  selector: 'cr-sheet-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ScDemo,
    ScPage,
    UiButton,
    UiFlow,
    UiSheet,
    UiStack,
    UiTextDirective,
  ],
  templateUrl: './sheet.page.html',
  styleUrl: './sheet.page.css',
})
export class SheetPage {
  protected readonly placements: UiSheetPlacement[] = [
    'bottom',
    'center',
    'end',
  ];

  /** Which demo sheet is presented — at most one at a time. */
  protected readonly presented = signal<SheetDemoKey | null>(null);
}
