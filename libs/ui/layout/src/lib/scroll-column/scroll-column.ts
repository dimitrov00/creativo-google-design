import {
  ChangeDetectionStrategy,
  Component,
  ViewEncapsulation,
  input,
} from '@angular/core';
import type { UiSpacing } from '../stack/stack';

/** SwiftUI parity: `.scrollTargetBehavior(.viewAligned)` alignment, on the vertical axis. */
export type UiScrollColumnSnap = 'none' | 'start' | 'center';

/**
 * SwiftUI parity: `ScrollView(.vertical)` with a bound — the vertical
 * counterpart of `ui-scroll-row`. A column that stacks its children and
 * scrolls them inside a frame no taller than
 * `--ui-scroll-column-max-block-size` (the consumer sets it on the host;
 * unset, the column is as tall as its content and never scrolls, so a short
 * list costs nothing). Two deliberate differences from the row: the scroll
 * indicator stays VISIBLE (HIG: an indicator tells people that content
 * scrolls — only carousels hide it), and the snap is PROXIMITY, never
 * mandatory — a vertical frame that refuses to rest between its items traps
 * the thumb at its end. Scrolling chains to the page when the frame is
 * done, as a nested scroll view should.
 */
@Component({
  selector: 'ui-scroll-column',
  template: `<ng-content />`,
  styleUrl: './scroll-column.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Unscoped: bare `.ui-*`/`[data-*]` selectors never match a component's
  // own HOST element under emulated encapsulation (see avatar.ts) — and
  // global `.ui-*` classes are this system's actual styling contract (§3.1).
  encapsulation: ViewEncapsulation.None,
  host: {
    class: 'ui-scroll-column',
    '[attr.data-snap]': 'uiSnap()',
    '[attr.data-spacing]': 'uiSpacing()',
  },
})
export class UiScrollColumn {
  readonly uiSnap = input<UiScrollColumnSnap>('none');
  readonly uiSpacing = input<UiSpacing>('regular');
}
