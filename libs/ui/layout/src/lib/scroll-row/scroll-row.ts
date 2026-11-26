import {
  ChangeDetectionStrategy,
  Component,
  ViewEncapsulation,
  computed,
  input,
} from '@angular/core';
import { keyboardScrollStop } from '../scroll-stop/scroll-stop';
import type { UiSpacing } from '../stack/stack';

/** SwiftUI parity: `.scrollTargetBehavior(.viewAligned)` alignment. */
export type UiScrollRowSnap = 'none' | 'start' | 'center';

/**
 * How far the row breaks out of its column. `true` = the VIEWPORT (a page's
 * centred column); `'container'` = the parent's inline padding (a sheet's
 * column: `--ui-sheet-inset`), so a shelf inside a sheet runs to the
 * sheet's edges and its first item still starts on the column's edge.
 */
export type UiScrollRowFullBleed = boolean | 'container';

/**
 * SwiftUI parity: `ScrollView(.horizontal)` + `.scrollIndicators(.hidden)` —
 * the horizontal carousel/strip container. Scroll indicators are ALWAYS
 * hidden; snap alignment applies per child. `uiFullBleed` breaks the row out
 * to the full viewport width while keeping content aligned to the page
 * gutter via the `--ui-scroll-row-gutter` custom property (consumers
 * override it to match their own gutter); `uiFullBleed="container"` breaks
 * it out of a sheet's column instead (the gutter defaults to the sheet's
 * own inset).
 *
 * `uiContainerRelativeCount` / `uiContainerRelativeSpan` ≙
 * `containerRelativeFrame(.horizontal, count:span:spacing:)` — every item's
 * width as a share of the row: `count` columns across the column's width,
 * each item `span` of them, the spacing between them counted. A count that
 * does not divide by the span is the PEEK: 7 / 2 shows three and a half
 * items, and the half says there is more.
 *
 * ```html
 * <ui-scroll-row uiFullBleed="container" uiSpacing="compact"
 *   [uiContainerRelativeCount]="7" [uiContainerRelativeSpan]="2">…</ui-scroll-row>
 * ```
 *
 * A KEYBOARD STOP when nothing else is (2026-09-28, WCAG 2.1.1 · axe
 * `scrollable-region-focusable`). A row of static cards that overflows —
 * the achievements' records — could not be scrolled without a pointer,
 * and its last card was out of reach. While the row overflows and holds
 * nothing focusable, it stamps `tabindex="0"` (the arrow keys then scroll
 * it), `role="group"` unless the consumer gave it a role, and `uiLabel` as
 * its name unless the consumer named it; it wears the house focus ring. A
 * row of buttons or links is already reachable and stays out of the tab
 * order. Whatever the consumer set itself (a tabindex, a role, a name) is
 * never written over or lifted.
 *
 * @uiPurpose A horizontal strip that scrolls its children sideways with
 *   snapping and hidden scroll indicators.
 * @uiSwiftUI `ScrollView(.horizontal)` with `.scrollIndicators(.hidden)` and
 *   `.containerRelativeFrame(_:count:span:spacing:)`
 * @uiAliases carousel, horizontal scroll, rail, slider, strip, overflow-x
 * @uiNotThis A list that scrolls vertically inside a capped frame is
 *   `ui-scroll-column`.
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
    '[attr.data-spacing]': 'uiSpacing()',
    '[attr.data-full-bleed]': 'fullBleed()',
    '[attr.data-relative]': "relativeCount() === null ? null : ''",
    '[style.--ui-scroll-row-count]': 'relativeCount()',
    '[style.--ui-scroll-row-span]':
      'relativeCount() === null ? null : uiContainerRelativeSpan()',
  },
})
export class UiScrollRow {
  readonly uiSnap = input<UiScrollRowSnap>('start');
  readonly uiSpacing = input<UiSpacing>('regular');
  /** `true` (or the bare attribute) = the viewport; `'container'` = the column. */
  readonly uiFullBleed = input<UiScrollRowFullBleed, UiScrollRowFullBleed | ''>(
    false,
    {
      transform: (value) => (value === '' ? true : value),
    },
  );
  /** ≙ `containerRelativeFrame`'s `count`: columns across the row. */
  readonly uiContainerRelativeCount = input<number | null>(null);
  /** ≙ its `span`: how many of those columns one item takes. */
  readonly uiContainerRelativeSpan = input(1);
  /**
   * The row's name when it becomes a keyboard stop (a row of static cards
   * that overflows) — the section's heading, «Рекорди». A consumer's own
   * `aria-label`/`aria-labelledby` wins.
   */
  readonly uiLabel = input<string | null>(null);

  constructor() {
    keyboardScrollStop('inline', this.uiLabel);
  }

  /** `''` for the viewport bleed, `'container'` for the column's, else none. */
  protected readonly fullBleed = computed(() => {
    const bleed = this.uiFullBleed();
    return bleed === 'container' ? 'container' : bleed ? '' : null;
  });

  /** A usable count or none: a share of zero columns is no width at all. */
  protected readonly relativeCount = computed(() => {
    const count = this.uiContainerRelativeCount();
    return count !== null && count > 0 ? count : null;
  });
}
