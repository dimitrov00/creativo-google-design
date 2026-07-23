import {
  ChangeDetectionStrategy,
  Component,
  ViewEncapsulation,
} from '@angular/core';

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
  },
})
export class UiCalendarGrid {}
