import { ChangeDetectionStrategy, Component } from '@angular/core';
import type { UiControlSize } from '@creativo/ui/controls';
import { UiTextField } from '@creativo/ui/controls';
import { UiFlow, UiStack } from '@creativo/ui/layout';
import { UiTextDirective } from '@creativo/ui/modifiers';
import { ScDemo } from '../../../shared/demo';
import { ScPage } from '../../../shared/page';

@Component({
  selector: 'cr-input-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ScDemo, ScPage, UiFlow, UiStack, UiTextDirective, UiTextField],
  templateUrl: './text-field.page.html',
  styleUrl: './text-field.page.css',
})
export class TextFieldPage {
  protected readonly sizes: UiControlSize[] = ['small', 'regular', 'large'];
}
