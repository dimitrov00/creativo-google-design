import { ChangeDetectionStrategy, Component } from '@angular/core';
import { UiScrollColumn, UiStack } from '@creativo/ui/layout';
import type { UiScrollColumnSnap } from '@creativo/ui/layout';
import { UiCard } from '@creativo/ui/patterns';
import { UiTextDirective } from '@creativo/ui/modifiers';
import { ScDemo } from '../../../shared/demo';
import { ScPage } from '../../../shared/page';

interface ListCard {
  readonly title: string;
  readonly detail: string;
}

@Component({
  selector: 'cr-scroll-column-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ScDemo, ScPage, UiCard, UiScrollColumn, UiStack, UiTextDirective],
  templateUrl: './scroll-column.page.html',
  styleUrl: './scroll-column.page.css',
})
export class ScrollColumnPage {
  protected readonly snaps: UiScrollColumnSnap[] = ['start', 'center', 'none'];
  protected readonly cards: ListCard[] = [
    { title: 'Balayage', detail: '2h 30m' },
    { title: 'Signature cut', detail: '1h' },
    { title: 'Color refresh', detail: '1h 45m' },
    { title: 'Keratin', detail: '3h' },
    { title: 'Blowout', detail: '45m' },
    { title: 'Highlights', detail: '2h' },
    { title: 'Treatment', detail: '30m' },
    { title: 'Updo', detail: '1h 15m' },
  ];
  protected readonly few: ListCard[] = this.cards.slice(0, 2);
}
