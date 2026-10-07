import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { StaffEventHead } from '@creativo/features/shared/visits';
import {
  UiIcon,
  UiListGroup,
  UiListRow,
  UiSectionHeader,
} from '@creativo/ui/controls';
import {
  UiTextDirective,
  UiVisuallyHiddenDirective,
} from '@creativo/ui/modifiers';
import type { ActivityGroupVm } from '../client-pages.vm';

/** The month heading's level: `h4` under the wallet's «Движение», `h3` on the ledger page. */
export type ActivityHeadingLevel = 3 | 4;

/**
 * THE ACTIVITY LIST — the journal as a statement (client-card-revision-3
 * §2.2.5, §3.13): one EVENT to a row, the rows grouped by month under a
 * quiet header that prints the month's net when the month is whole.
 * Mounted twice and drawn once: the wallet shows the newest five under
 * «Движение» (WG), the ledger page «Движение» every page it has read
 * (LE).
 *
 * A row is the shop's `ul[uiListGroup]` row (the `/account/appointments`
 * look the owner likes): a WHITE disc leading — `--sys-color-surface-
 * elevated` on the grey segment, in both themes — whose glyph names the
 * kind (a visit's scissors, a level's medal, a redemption's gift …) and
 * whose ink says whether the shop gave (accent) or took (primary); the
 * event head's two lines (what happened, then «5.09 · Иван»); the signed
 * amount trailing over the balance after it. The SIGN carries the
 * direction, never a colour (§1): «+27 т.» and «−250 т.» are the same
 * ink. A row that moved no points has no trailing figure. A row a later
 * entry reversed is struck through its title.
 *
 * Presentational: it computes nothing. Every string arrives final from
 * `ActivityGroupVm` (the presenter's `activityGroups`), and each row's one
 * spoken sentence is its `accessibleName`; the drawn parts are hidden
 * from a reader so nothing is said twice.
 */
@Component({
  selector: 'lib-activity-list',
  imports: [
    StaffEventHead,
    UiIcon,
    UiListGroup,
    UiListRow,
    UiSectionHeader,
    UiTextDirective,
    UiVisuallyHiddenDirective,
  ],
  templateUrl: './activity-list.html',
  styleUrl: './activity-list.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'activity-list' },
})
export class ActivityList {
  /** The months, newest first, each with its rows newest first. */
  readonly groups = input.required<readonly ActivityGroupVm[]>();
  /** `{prefix}-month-{YYYY-MM}` on a month, `{prefix}-entry-{entryId}` on a row. */
  readonly testIdPrefix = input.required<string>();
  /** The month heading's level: `h4` under a section heading (the wallet), `h3` on a page of its own. */
  readonly headingLevel = input<ActivityHeadingLevel>(4);

  /** The month heading's id, so its list is named by it. */
  protected monthHeadingId(key: string): string {
    return `${this.testIdPrefix()}-month-${key}-title`;
  }
}
