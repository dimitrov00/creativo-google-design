import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { UiBadgeTone } from '@creativo/ui/controls';
import { UiBadge, UiStack } from '@creativo/ui/controls';
import { UiTextDirective } from '@creativo/ui/modifiers';

@Component({
  selector: 'cr-badge-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, UiBadge, UiStack, UiTextDirective],
  templateUrl: './badge.page.html',
  styleUrl: './badge.page.css',
})
export class BadgePage {
  protected readonly tones: UiBadgeTone[] = [
    'neutral',
    'accent',
    'success',
    'warning',
    'destructive',
  ];
}
