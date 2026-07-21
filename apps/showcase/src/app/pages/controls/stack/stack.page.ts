import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import type {
  UiStackAlign,
  UiStackAxis,
  UiStackGap,
} from '@creativo/ui/controls';
import { UiStack } from '@creativo/ui/controls';
import { UiTextDirective } from '@creativo/ui/modifiers';

@Component({
  selector: 'cr-stack-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, UiStack, UiTextDirective],
  templateUrl: './stack.page.html',
  styleUrl: './stack.page.css',
})
export class StackPage {
  protected readonly axes: UiStackAxis[] = ['horizontal', 'vertical', 'z'];
  protected readonly gaps: UiStackGap[] = [
    'none',
    'tight',
    'compact',
    'regular',
    'comfortable',
    'loose',
    'spacious',
  ];
  protected readonly aligns: UiStackAlign[] = [
    'start',
    'center',
    'end',
    'stretch',
  ];
}
