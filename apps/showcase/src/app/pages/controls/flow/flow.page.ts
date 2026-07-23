import { ChangeDetectionStrategy, Component } from '@angular/core';
import { UiChip } from '@creativo/ui/controls';
import { UiFlow, UiStack } from '@creativo/ui/layout';
import type { UiAlignment, UiSpacing } from '@creativo/ui/layout';
import { UiFrameDirective, UiTextDirective } from '@creativo/ui/modifiers';
import { ScDemo } from '../../../shared/demo';
import { ScPage } from '../../../shared/page';

@Component({
  selector: 'cr-flow-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ScDemo,
    ScPage,
    UiChip,
    UiFlow,
    UiFrameDirective,
    UiStack,
    UiTextDirective,
  ],
  templateUrl: './flow.page.html',
  styleUrl: './flow.page.css',
})
export class FlowPage {
  protected readonly tags = [
    'Balayage',
    'Color',
    'Cut',
    'Styling',
    'Keratin',
    'Highlights',
    'Blowout',
    'Treatment',
    'Extensions',
    'Updo',
  ];
  protected readonly spacings: UiSpacing[] = [
    'tight',
    'regular',
    'comfortable',
  ];
  protected readonly aligns: Exclude<UiAlignment, 'stretch'>[] = [
    'leading',
    'center',
    'trailing',
  ];
}
