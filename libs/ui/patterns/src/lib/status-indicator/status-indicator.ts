import {
  ChangeDetectionStrategy,
  Component,
  ViewEncapsulation,
  input,
} from '@angular/core';

export type UiStatusIndicatorTone = 'success' | 'warning' | 'destructive';

/**
 * Status line — SwiftUI parity: a `Label` whose icon is
 * `Circle().fill(tone)`. A colored dot plus label text (open/closed,
 * availability states), with an optional muted trailing detail.
 *
 * Deliberately NOT ui-badge: this is a flat status line (leading dot +
 * text + detail), not a tinted capsule — the badge control has no
 * leading-dot slot and its fill would add a pill where designs want plain
 * text (comment inherited from the locations call site it replaces).
 *
 * Markup contract (default projection = label, detail is attribute-marked):
 * ```html
 * <ui-status-indicator [uiTone]="isOpen ? 'success' : 'destructive'">
 *   {{ statusLabel }}
 *   <span uiDetail>{{ closesAt }}</span>
 * </ui-status-indicator>
 * ```
 */
@Component({
  selector: 'ui-status-indicator',
  template: `
    <span class="ui-status-indicator__dot" aria-hidden="true"></span>
    <ng-content />
  `,
  styleUrl: './status-indicator.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Unscoped: bare `.ui-*`/`[data-*]` selectors never match a component's
  // own HOST element under emulated encapsulation (see avatar.ts) — and
  // global `.ui-*` classes are this system's actual styling contract (§3.1).
  encapsulation: ViewEncapsulation.None,
  host: {
    class: 'ui-status-indicator',
    '[attr.data-tone]': 'uiTone()',
  },
})
export class UiStatusIndicator {
  readonly uiTone = input.required<UiStatusIndicatorTone>();
}
