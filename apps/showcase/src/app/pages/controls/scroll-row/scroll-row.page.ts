import { ChangeDetectionStrategy, Component } from '@angular/core';
import { UiScrollRow, UiStack } from '@creativo/ui/layout';
import type { UiScrollRowSnap } from '@creativo/ui/layout';
import { UiCard } from '@creativo/ui/patterns';
import { UiFrameDirective, UiTextDirective } from '@creativo/ui/modifiers';
import { ScDemo } from '../../../shared/demo';
import { ScPage } from '../../../shared/page';

interface StripCard {
  readonly title: string;
  readonly detail: string;
}

@Component({
  selector: 'cr-scroll-row-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ScDemo,
    ScPage,
    UiCard,
    UiFrameDirective,
    UiScrollRow,
    UiStack,
    UiTextDirective,
  ],
  templateUrl: './scroll-row.page.html',
  styleUrl: './scroll-row.page.css',
})
export class ScrollRowPage {
  protected readonly snaps: UiScrollRowSnap[] = ['start', 'center', 'none'];
  protected readonly cards: StripCard[] = [
    { title: 'Balayage', detail: '2h 30m' },
    { title: 'Signature cut', detail: '1h' },
    { title: 'Color refresh', detail: '1h 45m' },
    { title: 'Keratin', detail: '3h' },
    { title: 'Blowout', detail: '45m' },
    { title: 'Highlights', detail: '2h' },
    { title: 'Treatment', detail: '30m' },
    { title: 'Updo', detail: '1h 15m' },
  ];
}
