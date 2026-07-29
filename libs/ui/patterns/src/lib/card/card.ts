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

/**
 * Elevated content surface — the base card pattern.
 *
 * The `a[uiCard]` / `button[uiCard]` forms (≙ a `NavigationLink` or
 * `Button` whose label IS the card, same precedent as `a[uiListRow]` /
 * `button[uiListRow]`) make the whole card the actionable element — free
 * native semantics, zero ARIA hand-rolling. Use the button form when the
 * card opens something in place (a sheet destination) rather than
 * navigating to a URL. Pair either with `[uiInteractive]="true"` so the
 * shared state-layer grammar carries the hover/press feedback.
 *
 * Neither form may contain further interactive content — nesting a control
 * inside a button is invalid HTML; reach for `ui-card` plus your own
 * control in that case.
 */
@Component({
  selector: 'ui-card, a[uiCard], button[uiCard]',
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
