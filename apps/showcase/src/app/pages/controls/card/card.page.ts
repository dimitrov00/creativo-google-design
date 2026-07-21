import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { UiCardPadding, UiCardTone } from '@creativo/ui/controls';
import { UiCard, UiStack } from '@creativo/ui/controls';
import { UiTextDirective } from '@creativo/ui/modifiers';

@Component({
  selector: 'cr-card-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, UiCard, UiStack, UiTextDirective],
  templateUrl: './card.page.html',
  styleUrl: './card.page.css',
})
export class CardPage {
  protected readonly tones: UiCardTone[] = ['plain', 'accent', 'muted'];
  protected readonly interactiveStates = [false, true];
  protected readonly paddings: UiCardPadding[] = [
    'none',
    'tight',
    'compact',
    'regular',
    'comfortable',
    'loose',
    'spacious',
  ];
}
