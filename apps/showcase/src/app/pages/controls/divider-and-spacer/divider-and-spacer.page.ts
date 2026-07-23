import { ChangeDetectionStrategy, Component } from '@angular/core';
import { UiButton, UiIcon } from '@creativo/ui/controls';
import { UiDivider, UiSpacer, UiStack, UiToolbar } from '@creativo/ui/layout';
import { UiCard } from '@creativo/ui/patterns';
import { UiFrameDirective, UiTextDirective } from '@creativo/ui/modifiers';
import { ScDemo } from '../../../shared/demo';
import { ScPage } from '../../../shared/page';

@Component({
  selector: 'cr-divider-and-spacer-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ScDemo,
    ScPage,
    UiButton,
    UiCard,
    UiDivider,
    UiFrameDirective,
    UiIcon,
    UiSpacer,
    UiStack,
    UiTextDirective,
    UiToolbar,
  ],
  templateUrl: './divider-and-spacer.page.html',
  styleUrl: './divider-and-spacer.page.css',
})
export class DividerAndSpacerPage {}
