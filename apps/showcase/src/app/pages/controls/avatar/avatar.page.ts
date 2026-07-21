import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { UiControlSize } from '@creativo/ui/controls';
import { UiAvatar, UiStack } from '@creativo/ui/controls';
import { UiTextDirective } from '@creativo/ui/modifiers';

const DEMO_IMAGE =
  'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=160&h=160&fit=crop&crop=faces';

@Component({
  selector: 'cr-avatar-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, UiAvatar, UiStack, UiTextDirective],
  templateUrl: './avatar.page.html',
  styleUrl: './avatar.page.css',
})
export class AvatarPage {
  protected readonly sizes: UiControlSize[] = [
    'compact',
    'regular',
    'prominent',
  ];
  protected readonly withImageStates = [false, true];
  protected readonly demoImage = DEMO_IMAGE;
}
