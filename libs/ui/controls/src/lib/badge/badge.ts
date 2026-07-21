import {
  ChangeDetectionStrategy,
  Component,
  ViewEncapsulation,
  input,
} from '@angular/core';

export type UiBadgeTone =
  'neutral' | 'accent' | 'success' | 'warning' | 'destructive';

/** Native `<span>` element — a static status token, non-interactive. */
@Component({
  selector: 'span[uiBadge]',
  template: `<ng-content />`,
  styleUrl: './badge.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Unscoped: bare `.ui-*`/`[data-*]` selectors never match a component's
  // own HOST element under emulated encapsulation (see avatar.ts) — and
  // global `.ui-*` classes are this system's actual styling contract (§3.1).
  encapsulation: ViewEncapsulation.None,
  host: {
    class: 'ui-badge',
    '[attr.data-tone]': 'uiTone()',
  },
})
export class UiBadge {
  readonly uiTone = input<UiBadgeTone>('neutral');
}
