import {
  ChangeDetectionStrategy,
  Component,
  ViewEncapsulation,
  input,
} from '@angular/core';
import type { UiStackGap } from '../stack/stack';

/** SwiftUI parity: `.scrollTargetBehavior(.viewAligned)` alignment. */
export type UiScrollRowSnap = 'none' | 'start' | 'center';

/**
 * SwiftUI parity: `ScrollView(.horizontal)` + `.scrollIndicators(.hidden)` —
 * the horizontal carousel/strip container. Scroll indicators are ALWAYS
 * hidden; snap alignment applies per child. `uiFullBleed` breaks the row out
 * to the full viewport width while keeping content aligned to the page
 * gutter via the `--ui-scroll-row-gutter` custom property (consumers
 * override it to match their own gutter).
 */
@Component({
  selector: 'ui-scroll-row',
  template: `<ng-content />`,
  styleUrl: './scroll-row.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Unscoped: bare `.ui-*`/`[data-*]` selectors never match a component's
  // own HOST element under emulated encapsulation (see avatar.ts) — and
  // global `.ui-*` classes are this system's actual styling contract (§3.1).
  encapsulation: ViewEncapsulation.None,
  host: {
    class: 'ui-scroll-row',
    '[attr.data-snap]': 'uiSnap()',
    '[attr.data-gap]': 'uiGap()',
    '[attr.data-full-bleed]': "uiFullBleed() ? '' : null",
  },
})
export class UiScrollRow {
  readonly uiSnap = input<UiScrollRowSnap>('start');
  readonly uiGap = input<UiStackGap>('regular');
  readonly uiFullBleed = input(false);
}
