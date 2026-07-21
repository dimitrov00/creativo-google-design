import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { UiButtonVariant, UiControlSize } from '@creativo/ui/controls';
import { UiButton, UiStack } from '@creativo/ui/controls';
import { UiTextDirective } from '@creativo/ui/modifiers';

@Component({
  selector: 'cr-button-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, UiButton, UiStack, UiTextDirective],
  templateUrl: './button.page.html',
  styleUrl: './button.page.css',
})
export class ButtonPage {
  protected readonly variants: UiButtonVariant[] = [
    'prominent',
    'bordered',
    'tinted',
    'plain',
    'destructive',
  ];
  protected readonly sizes: UiControlSize[] = [
    'compact',
    'regular',
    'prominent',
  ];
}
