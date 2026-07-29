import {
  ChangeDetectionStrategy,
  Component,
  ViewEncapsulation,
  input,
} from '@angular/core';

export type UiBadgeTone =
  'neutral' | 'accent' | 'success' | 'warning' | 'destructive';
/** House size axis (list-row precedent): `regular` is the caption-tight
 *  status token; `large` is the chunky display capsule (sheet variant /
 *  bundle lists). */
export type UiBadgeSize = 'regular' | 'large';

/**
 * ≙ SwiftUI `.badgeProminence(_:)` — how loudly the badge asks to be
 * noticed. Orthogonal to `uiTone`, which says what it MEANS: tone picks
 * the colour, prominence picks how much of it you get.
 *
 * - `decreased` — quiet secondary text, no capsule. SwiftUI's own
 *   `.decreased`, and what a plain informational count looks like
 *   ("1,234 photos").
 * - `standard` — the tinted capsule (14% fill, tone ink). The default.
 * - `increased` — the SOLID badge: saturated fill, white ink, circular at
 *   one digit. This is the iOS notification badge, and it is the tier for
 *   a count someone is meant to ACT on.
 */
export type UiBadgeProminence = 'decreased' | 'standard' | 'increased';

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
    '[attr.data-size]': 'uiSize()',
    '[attr.data-prominence]': 'uiProminence()',
  },
})
export class UiBadge {
  readonly uiTone = input<UiBadgeTone>('neutral');
  readonly uiSize = input<UiBadgeSize>('regular');
  readonly uiProminence = input<UiBadgeProminence>('standard');
}
