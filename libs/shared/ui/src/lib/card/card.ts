import { ChangeDetectionStrategy, Component, input } from '@angular/core';

export type CardElevation = 0 | 1 | 2 | 3 | 4 | 5;

@Component({
  selector: 'cr-card',
  imports: [],
  templateUrl: './card.html',
  styleUrl: './card.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'cr-card',
    '[attr.data-elevation]': 'elevation()',
    '[attr.data-padded]': 'padded() ? "" : null',
    '[attr.data-interactive]': 'interactive() ? "" : null',
  },
})
export class Card {
  readonly imageUrl = input<string>();
  readonly imageAlt = input('');
  readonly elevation = input<CardElevation>(1);
  readonly padded = input(true);
  /** Presentational hover affordance (accent-tinted background) for a card the consumer is structuring as clickable — see card.css. */
  readonly interactive = input(false);
}
