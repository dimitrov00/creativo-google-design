import { ChangeDetectionStrategy, Component } from '@angular/core';
import { UiBadge, UiMediaCard } from '@creativo/ui/controls';
import { UiScrollRow, UiStack } from '@creativo/ui/layout';
import type { UiScrollRowSnap } from '@creativo/ui/layout';
import { UiCard } from '@creativo/ui/patterns';
import {
  UiFrameDirective,
  UiInteractiveDirective,
  UiTextDirective,
} from '@creativo/ui/modifiers';
import { ScDemo } from '@showcase/shared/demo';
import { ScPage } from '@showcase/shared/page';

interface StripCard {
  readonly title: string;
  readonly detail: string;
}

/** A photo-rail tile: the short date it wears, the name it is read by. */
interface RailPhoto {
  readonly date: string;
  readonly label: string;
}

@Component({
  selector: 'cr-scroll-row-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ScDemo,
    ScPage,
    UiBadge,
    UiCard,
    UiFrameDirective,
    UiInteractiveDirective,
    UiMediaCard,
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
  /** Six tiles, the rail's cap: three and a half show, the rest scroll. */
  protected readonly photos: readonly RailPhoto[] = [
    { date: '12.08', label: 'Снимка от 12 август' },
    { date: '15.07', label: 'Снимка от 15 юли' },
    { date: '20.06', label: 'Снимка от 20 юни' },
    { date: '3.06', label: 'Снимка от 3 юни' },
    { date: '8.05', label: 'Снимка от 8 май' },
    { date: '10.04', label: 'Снимка от 10 април' },
  ];
}
