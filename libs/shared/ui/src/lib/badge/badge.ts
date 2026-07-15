import { ChangeDetectionStrategy, Component, input } from '@angular/core';

export type BadgeTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger';

@Component({
  selector: 'cr-badge',
  imports: [],
  templateUrl: './badge.html',
  styleUrl: './badge.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'cr-badge',
    '[attr.role]': 'live() ? "status" : null',
    '[attr.data-tone]': 'tone()',
  },
})
export class Badge {
  readonly tone = input<BadgeTone>('neutral');
  /** Only static tone chips by default — opt in for badges whose content updates dynamically and should be announced. */
  readonly live = input(false);
}
