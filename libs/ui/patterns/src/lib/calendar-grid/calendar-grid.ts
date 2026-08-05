import {
  ChangeDetectionStrategy,
  Component,
  ViewEncapsulation,
  input,
} from '@angular/core';

/**
 * How big the day cells are.
 *
 * `regular` is the standing control size — a calendar embedded in a card
 * alongside other content. `large` is the Calendar-app treatment: the grid IS
 * the screen, cells are generous tap targets and the numbers carry the page.
 * Choosing a size is choosing which of those two a screen is; there is no
 * in-between worth a third token.
 */
export type UiCalendarGridSize = 'regular' | 'large';

/**
 * Headless 7-column month-grid layout — lays out whatever content is
 * projected (weekday header cells, then day cells) in reading order via
 * CSS grid auto-flow. Carries no date logic of its own; a feature lib
 * supplies the cells (e.g. via `UiDateBadge`) and the grid.
 *
 * Cell contract (attribute-marked slots like ui-list-row; both optional):
 * - `[uiWeekday]` — a weekday header cell; centered caption alignment.
 * - `button[uiDay]` — a day tap cell; UA button chrome stripped, content
 *   centered. Interaction feedback comes from the shared `uiInteractive`
 *   grammar (add the directive; never a bespoke hover), e.g.
 *   `<button uiDay uiInteractive uiRadius="capsule">`.
 *
 * ### Sizing is set here, not on every badge
 * `uiSize` publishes `--ui-date-badge-size` and its matching type scale to
 * every descendant, so a consumer sizes a month once instead of threading an
 * input through forty-two badges. A `ui-date-badge` used outside a grid keeps
 * its own standing size, so nothing depends on being inside one.
 *
 * The weekday header row is projected rather than generated because the
 * labels are localized and Monday-first is a product decision, not a layout
 * one — generating them would mean taking a locale, which is exactly the date
 * logic this grid exists without. A scrolling run of months wants that row
 * pinned once above all of them rather than repeated: see
 * `ui-calendar-scroller`.
 */
@Component({
  selector: 'ui-calendar-grid',
  template: `<ng-content />`,
  styleUrl: './calendar-grid.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Unscoped: bare `.ui-*`/`[data-*]` selectors never match a component's
  // own HOST element under emulated encapsulation (see avatar.ts) — and
  // global `.ui-*` classes are this system's actual styling contract (§3.1).
  encapsulation: ViewEncapsulation.None,
  host: {
    class: 'ui-calendar-grid',
    '[attr.data-size]': 'uiSize()',
  },
})
export class UiCalendarGrid {
  readonly uiSize = input<UiCalendarGridSize>('regular');
}
