import {
  ChangeDetectionStrategy,
  Component,
  ViewEncapsulation,
} from '@angular/core';

/**
 * A continuously scrolling run of months — the Calendar-app shape.
 *
 * ### Why scroll rather than page
 * A paged month grid asks "which month?" before it will answer "which day?",
 * and the answer to the first is almost always *this one or the next one*. It
 * also hides the boundary that matters most: the last week of a month and the
 * first week of the next are the same fortnight to a person deciding when to
 * come in, and a pager puts a button press between them. Scrolling makes the
 * horizon a distance rather than a count of taps.
 *
 * ### Slot contract
 * `[uiCalendarLede]` — the screen's own heading, scrolling AWAY at the top.
 * `[uiCalendarMonth]` — one month section, in order. Its own label goes inside
 * it and scrolls away with it, which is what tells you where the boundary
 * fell.
 *
 * ```html
 * <ui-calendar-scroller>
 *   <div uiCalendarLede><h1>When suits you?</h1></div>
 *   @for (month of months(); track month.key) {
 *     <section uiCalendarMonth>
 *       <h2>{{ month.label }}</h2>
 *       <ui-calendar-grid uiSize="large"> …cells… </ui-calendar-grid>
 *     </section>
 *   }
 * </ui-calendar-scroller>
 * ```
 *
 * ### The heading scrolls — all of it
 * `uiCalendarLede` is what lets the consumer's whole heading — title, lede and
 * the weekday key that closes it — pass UNDER the page chrome as one block.
 * Rendered in a fixed slab above this box it never scrolled, so the house
 * large-title collapse never fired and the chrome's fade had nothing beneath
 * it to dissolve.
 *
 * There is deliberately NO pinned header slot here. One briefly existed, with
 * an opaque fill and a ramp of its own, and it meant the title collapsed into
 * the bar at one scroll position and the key pinned at another — two things
 * that read as one block behaving as two, over two stacked gradients. The
 * consumer's chrome re-renders the key alongside its collapsed title instead,
 * so both arrive together and the page toolbar's own scrim is the only fade on
 * screen.
 *
 * ### What this does NOT do
 * No virtualization and no infinite loading. The run is bounded by a booking
 * horizon measured in months, so the whole thing is a few hundred cells —
 * cheaper to render than the `IntersectionObserver` bookkeeping that windowing
 * would need, and it keeps browser find-in-page and anchor scrolling working.
 * A calendar that genuinely runs to a distant horizon would need a different
 * component, not an input on this one.
 *
 * Carries no date logic whatsoever, like `ui-calendar-grid`: it is a scroll
 * box with a rhythm.
 */
@Component({
  selector: 'ui-calendar-scroller',
  // The lede is a DIRECT child of the scroll box so the whole heading travels
  // with the run rather than sitting above it — see the class docblock.
  template: `<ng-content select="[uiCalendarLede]" />
    <div class="ui-calendar-scroller__months">
      <ng-content />
    </div>`,
  styleUrl: './calendar-scroller.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Unscoped: bare `.ui-*`/`[data-*]` selectors never match a component's
  // own HOST element under emulated encapsulation (see avatar.ts) — and
  // global `.ui-*` classes are this system's actual styling contract (§3.1).
  encapsulation: ViewEncapsulation.None,
  host: {
    class: 'ui-calendar-scroller',
  },
})
export class UiCalendarScroller {}
