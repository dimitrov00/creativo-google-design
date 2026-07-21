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
export type UiCardTone = 'plain' | 'accent' | 'muted';

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
