import {
  ChangeDetectionStrategy,
  Component,
  ViewEncapsulation,
  input,
} from '@angular/core';

export type UiCardPadding =
  | 'none'
  | 'tight'
  | 'compact'
  | 'regular'
  | 'comfortable'
  | 'loose'
  | 'spacious';
/**
 * Card surface tones.
 *
 * `elevated` is the SwiftUI grouped-background step — parity with
 * `secondarySystemGroupedBackground` sitting on `systemGroupedBackground`:
 * the card renders one surface level ABOVE its container. In dark themes
 * elevation reads as a LIGHTER fill (`--sys-color-surface-elevated`); in
 * light themes the fill stays surface white and the card's elevation
 * shadow carries the lift (iOS white-card-on-grey grouping). Reach for it
 * whenever the card sits on an already-surface-colored container (e.g.
 * inside a sheet), where a `plain` card would be invisible in dark mode.
 */
export type UiCardTone = 'plain' | 'accent' | 'muted' | 'elevated';

/** Elevated content surface — the base card pattern. */
@Component({
  selector: 'ui-card',
  template: `<ng-content />`,
  styleUrl: './card.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Unscoped: bare `.ui-*`/`[data-*]` selectors never match a component's
  // own HOST element under emulated encapsulation (see avatar.ts) — and
  // global `.ui-*` classes are this system's actual styling contract (§3.1).
  encapsulation: ViewEncapsulation.None,
  host: {
    class: 'ui-card',
    '[attr.data-padding]': 'uiPadding()',
    '[attr.data-tone]': 'uiTone()',
    '[attr.data-interactive]': "uiInteractive() ? '' : null",
  },
})
export class UiCard {
  readonly uiPadding = input<UiCardPadding>('comfortable');
  readonly uiTone = input<UiCardTone>('plain');
  readonly uiInteractive = input(false);
}
