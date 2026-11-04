import { ChangeDetectionStrategy, Component } from '@angular/core';
import { UiStack } from '@creativo/ui/layout';
import { UiTextDirective } from '@creativo/ui/modifiers';
import {
  UiListGroup,
  UiListRow,
  UiMarkedText,
  type UiMarkedRun,
} from '@creativo/ui/patterns';
import { ScDemo } from '@showcase/shared/demo';
import { ScPage } from '@showcase/shared/page';

@Component({
  selector: 'cr-marked-text-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ScDemo,
    ScPage,
    UiListGroup,
    UiListRow,
    UiMarkedText,
    UiStack,
    UiTextDirective,
  ],
  templateUrl: './marked-text.page.html',
  styleUrl: './marked-text.page.css',
})
export class MarkedTextPage {
  protected readonly plain: readonly UiMarkedRun[] = [
    { text: 'Класическа подстрижка', hit: false },
  ];
  protected readonly one: readonly UiMarkedRun[] = [
    { text: 'Класи', hit: true },
    { text: 'ческа подстрижка', hit: false },
  ];
  protected readonly several: readonly UiMarkedRun[] = [
    { text: 'Къ', hit: false },
    { text: 'са', hit: true },
    { text: ' ко', hit: false },
    { text: 'са', hit: true },
  ];
  protected readonly phone: readonly UiMarkedRun[] = [
    { text: '+359 ', hit: false },
    { text: '88 777 8899', hit: true },
  ];
  protected readonly wrapped: readonly UiMarkedRun[] = [
    { text: 'Подстригване, измиване и оформяне на ', hit: false },
    { text: 'брада с машинка и бръснач', hit: true },
    { text: ' по желание на клиента', hit: false },
  ];
}
