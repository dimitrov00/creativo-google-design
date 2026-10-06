import { ChangeDetectionStrategy, Component } from '@angular/core';
import type {
  UiDateTileControlSize,
  UiDateTileTone,
} from '@creativo/ui/controls';
import { UiDateTile, UiListRow } from '@creativo/ui/controls';
import { UiFlow, UiStack } from '@creativo/ui/layout';
import { UiTextDirective } from '@creativo/ui/modifiers';
import { ScDemo } from '../../../shared/demo';
import { ScPage } from '../../../shared/page';

interface VisitSample {
  readonly caption: string;
  readonly day: number;
  readonly tone: UiDateTileTone;
  readonly title: string;
  readonly facts: string;
}

@Component({
  selector: 'cr-date-tile-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ScDemo,
    ScPage,
    UiDateTile,
    UiFlow,
    UiListRow,
    UiStack,
    UiTextDirective,
  ],
  templateUrl: './date-tile.page.html',
  styleUrl: './date-tile.page.css',
})
export class DateTilePage {
  protected readonly tones: readonly {
    readonly tone: UiDateTileTone;
    readonly note: string;
  }[] = [
    { tone: 'upcoming', note: 'still ahead: the accent wash, the day in ink' },
    { tone: 'past', note: 'a memory: the control fill, the day in ink' },
    { tone: 'hollow', note: 'did not happen: a hairline ring' },
  ];

  protected readonly sizes: readonly UiDateTileControlSize[] = [
    'regular',
    'large',
  ];

  /** A year section of the staff history: the tile says the month. */
  protected readonly visits: readonly VisitSample[] = [
    {
      caption: 'окт.',
      day: 2,
      tone: 'upcoming',
      title: 'Фейд',
      facts: 'пт, 10:00 · Иван',
    },
    {
      caption: 'септ.',
      day: 4,
      tone: 'past',
      title: 'Фейд',
      facts: 'Иван · Център',
    },
    {
      caption: 'авг.',
      day: 12,
      tone: 'hollow',
      title: 'Брада',
      facts: 'Не дойде',
    },
  ];
}
