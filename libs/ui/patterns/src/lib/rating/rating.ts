import {
  ChangeDetectionStrategy,
  Component,
  ViewEncapsulation,
  input,
} from '@angular/core';

/**
 * Star-rating stat cluster — SwiftUI parity:
 * `Label("4.9", systemImage: "star.fill")`. A filled star glyph plus the
 * numeric value (tabular-nums so lists of ratings align), with optional
 * projected trailing content (e.g. a review count).
 *
 * Ink is `currentColor` — consumers set `uiForeground` (or leave the
 * inherited ink) on the host; the cluster never picks its own color.
 * ```html
 * <ui-rating [uiValue]="barber.rating">(128)</ui-rating>
 * ```
 */
@Component({
  selector: 'ui-rating',
  template: `
    <span class="ui-rating__star" aria-hidden="true">star</span>
    <span class="ui-rating__value">{{ uiValue() }}</span>
    <ng-content />
  `,
  styleUrl: './rating.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Unscoped: bare `.ui-*`/`[data-*]` selectors never match a component's
  // own HOST element under emulated encapsulation (see avatar.ts) — and
  // global `.ui-*` classes are this system's actual styling contract (§3.1).
  encapsulation: ViewEncapsulation.None,
  host: {
    class: 'ui-rating',
  },
})
export class UiRating {
  readonly uiValue = input.required<number>();
}
