import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { UiAvatar, UiIcon } from '@creativo/ui/controls';
import { UiDivider, UiStack } from '@creativo/ui/layout';
import type { UiListRowAlignment, UiListRowSize } from '@creativo/ui/patterns';
import { UiCard, UiListGroup, UiListRow } from '@creativo/ui/patterns';
import {
  UiForegroundStyleDirective,
  UiFrameDirective,
  UiTextDirective,
} from '@creativo/ui/modifiers';
import { ScDemo } from '@showcase/shared/demo';
import { ScPage } from '@showcase/shared/page';

@Component({
  selector: 'cr-list-row-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    ScDemo,
    ScPage,
    UiAvatar,
    UiCard,
    UiDivider,
    UiFrameDirective,
    UiIcon,
    UiForegroundStyleDirective,
    UiListGroup,
    UiListRow,
    UiStack,
    UiTextDirective,
  ],
  templateUrl: './list-row.page.html',
  styleUrl: './list-row.page.css',
})
export class ListRowPage {
  /** Both cross-axis placements, shown on a row whose label stacks. */
  protected readonly alignments: readonly UiListRowAlignment[] = [
    'center',
    'leading',
  ];
  /** Both rungs on a stacked label — the picker row and the settings row. */
  protected readonly sizes: readonly UiListRowSize[] = ['regular', 'large'];
  /** The destructive demo's second row, armed as its own confirm. */
  protected readonly armed = signal(false);
}
