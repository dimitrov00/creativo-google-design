import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { UiIcon } from '@creativo/ui/controls';
import { UiDivider, UiStack } from '@creativo/ui/layout';
import { UiCard, UiListRow } from '@creativo/ui/patterns';
import { UiFrameDirective, UiTextDirective } from '@creativo/ui/modifiers';
import { ScDemo } from '../../../shared/demo';
import { ScPage } from '../../../shared/page';

@Component({
  selector: 'cr-list-row-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    ScDemo,
    ScPage,
    UiCard,
    UiDivider,
    UiFrameDirective,
    UiIcon,
    UiListRow,
    UiStack,
    UiTextDirective,
  ],
  templateUrl: './list-row.page.html',
  styleUrl: './list-row.page.css',
})
export class ListRowPage {}
