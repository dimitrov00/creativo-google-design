import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { UiCardPadding, UiCardTone } from '@creativo/ui/patterns';
import { UiCard } from '@creativo/ui/patterns';
import { UiFlow, UiStack } from '@creativo/ui/layout';
import { UiTextDirective } from '@creativo/ui/modifiers';
import { ScDemo } from '../../../shared/demo';
import { ScPage } from '../../../shared/page';

@Component({
  selector: 'cr-card-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    ScDemo,
    ScPage,
    UiCard,
    UiFlow,
    UiStack,
    UiTextDirective,
  ],
  templateUrl: './card.page.html',
  styleUrl: './card.page.css',
})
export class CardPage {
  /** `elevated` demos separately — it needs a muted container to read. */
  protected readonly tones: UiCardTone[] = ['plain', 'accent', 'muted'];

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
