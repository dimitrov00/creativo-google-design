import { ChangeDetectionStrategy, Component } from '@angular/core';
import type { UiAlignment, UiSpacing, UiStackAxis } from '@creativo/ui/layout';
import { UiFlow, UiStack } from '@creativo/ui/layout';
import { UiTextDirective } from '@creativo/ui/modifiers';
import { ScDemo } from '../../../shared/demo';
import { ScPage } from '../../../shared/page';

@Component({
  selector: 'cr-stack-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ScDemo, ScPage, UiFlow, UiStack, UiTextDirective],
  templateUrl: './stack.page.html',
  styleUrl: './stack.page.css',
})
export class StackPage {
  protected readonly axes: UiStackAxis[] = ['horizontal', 'vertical', 'z'];
  protected readonly gaps: UiSpacing[] = [
    'none',
    'tight',
    'compact',
    'regular',
    'comfortable',
    'loose',
    'spacious',
  ];
  protected readonly aligns: UiAlignment[] = [
    'leading',
    'center',
    'trailing',
    'stretch',
  ];
}
