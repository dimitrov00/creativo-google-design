import { ChangeDetectionStrategy, Component } from '@angular/core';
import { UiButton } from '@creativo/ui/controls';
import { UiStack, UiToolbar } from '@creativo/ui/layout';
import { UiTextDirective } from '@creativo/ui/modifiers';
import { ScDemo } from '../../../shared/demo';
import { ScPage } from '../../../shared/page';

@Component({
  selector: 'cr-toolbar-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ScDemo, ScPage, UiButton, UiStack, UiToolbar, UiTextDirective],
  templateUrl: './toolbar.page.html',
  styleUrl: './toolbar.page.css',
})
export class ToolbarPage {
  protected readonly scrollLines = Array.from({ length: 10 }, (_, i) => i + 1);
}
