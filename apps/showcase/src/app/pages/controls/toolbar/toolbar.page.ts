import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { UiButton, UiStack, UiToolbar } from '@creativo/ui/controls';
import { UiTextDirective } from '@creativo/ui/modifiers';

@Component({
  selector: 'cr-toolbar-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, UiButton, UiStack, UiToolbar, UiTextDirective],
  templateUrl: './toolbar.page.html',
  styleUrl: './toolbar.page.css',
})
export class ToolbarPage {
  protected readonly scrollLines = Array.from({ length: 10 }, (_, i) => i + 1);
}
