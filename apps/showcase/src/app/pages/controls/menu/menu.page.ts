import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { UiButton, UiIcon } from '@creativo/ui/controls';
import { UiStack } from '@creativo/ui/layout';
import { UiMenu, UiMenuItem, UiMenuTrigger } from '@creativo/ui/patterns';
import { UiTextDirective } from '@creativo/ui/modifiers';
import { ScDemo } from '../../../shared/demo';
import { ScPage } from '../../../shared/page';

@Component({
  selector: 'cr-menu-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ScDemo,
    ScPage,
    UiButton,
    UiIcon,
    UiMenu,
    UiMenuItem,
    UiMenuTrigger,
    UiStack,
    UiTextDirective,
  ],
  templateUrl: './menu.page.html',
  styleUrl: './menu.page.css',
})
export class MenuPage {
  protected readonly plainOpen = signal(false);
  protected readonly destructiveOpen = signal(false);
  protected readonly alignedOpen = signal(false);
  protected readonly lastAction = signal('—');

  protected run(action: string): void {
    this.lastAction.set(action);
  }
}
