import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { UiBadge, UiButton } from '@creativo/ui/controls';
import { UiLogo } from '@creativo/ui/icons';
import { UiStack } from '@creativo/ui/layout';
import { UiTextDirective } from '@creativo/ui/modifiers';
import { UiPassCard } from '@creativo/ui/patterns';
import { ScDemo } from '@showcase/shared/demo';
import { ScPage } from '@showcase/shared/page';

/** One pass of the states demo: what the card prints, and how it is named. */
interface PassSample {
  readonly id: string;
  /** What the sample shows, for the page's reader. */
  readonly caption: string;
  readonly figure: string;
  readonly unit: string;
  readonly holder: string | null;
  readonly tier: string | null;
  readonly since: string | null;
  readonly state: string | null;
  /** The ONE accessible name. */
  readonly name: string;
}

@Component({
  selector: 'cr-pass-card-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ScDemo,
    ScPage,
    UiBadge,
    UiButton,
    UiLogo,
    UiPassCard,
    UiStack,
    UiTextDirective,
  ],
  templateUrl: './pass-card.page.html',
  styleUrl: './pass-card.page.css',
})
export class PassCardPage {
  /** A paused client: the field desaturates, the state line says so. */
  protected readonly frozen = signal(true);

  /** What a flag takes off the card, and what a new client has not got yet. */
  protected readonly quieter: readonly PassSample[] = [
    {
      id: 'no-tiers',
      caption: 'loyalty.tiers off: no plate',
      figure: '371',
      unit: 'точки',
      holder: 'Георги Петров',
      tier: null,
      since: 'Клиент от март 2025 г.',
      state: null,
      name: 'Карта за лоялност: Георги Петров, 371 точки за размяна, клиент от март 2025 г.',
    },
    {
      id: 'no-points',
      caption: 'loyalty.points off: the tier’s count is the figure',
      figure: '13',
      unit: 'посещения',
      holder: 'Георги Петров',
      tier: 'Злато',
      since: 'Клиент от март 2025 г.',
      state: null,
      name: 'Карта за лоялност: Георги Петров, Злато, 13 посещения, клиент от март 2025 г.',
    },
    {
      id: 'new',
      caption: 'before the first worked visit: no quiet line',
      figure: '0',
      unit: 'точки',
      holder: 'Мартин Илиев',
      tier: 'Бронз',
      since: null,
      state: null,
      name: 'Карта за лоялност: Мартин Илиев, Бронз, 0 точки за размяна',
    },
  ];
}
