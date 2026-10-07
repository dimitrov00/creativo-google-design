import { NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from '@angular/core';
import { TranslocoDirective } from '@jsverse/transloco';
import {
  UiButton,
  UiEmptyState,
  UiListGroup,
  UiListRow,
  UiNotice,
  UiSectionHeader,
  UiSkeleton,
  UiStack,
} from '@creativo/ui/controls';
import {
  UiFrameDirective,
  UiMultilineTextAlignmentDirective,
  UiRadiusDirective,
  UiTextDirective,
} from '@creativo/ui/modifiers';
import { VisitRow } from '../visit-row/visit-row';
import type {
  VisitListStyle,
  VisitPerspective,
  VisitSectionVm,
} from '../visit-row.vm';

/** Where the list stands: its rows, their placeholders, or the reason there are none. */
export type VisitListState = 'loading' | 'ready' | 'error';

/**
 * The foot of a paged list — `more`: another page waits («Покажи още»);
 * `loading`: it is on its way (the button's own ring); `failed`: it did not
 * come («Опитай пак»); `end`: nothing older is left, and `endLabel` says
 * so in the host's words («Това е всичко · първото посещение е на …»), or
 * nothing when null.
 */
export interface VisitListPaging {
  readonly kind: 'more' | 'loading' | 'failed' | 'end';
  readonly endLabel: string | null;
}

/**
 * THE VISITS LIST (client-card redesign §5.3.3) — «Моите часове» and a
 * client's history on the staff card, one list: sections, each a heading
 * and its rows, then the page's foot.
 *
 * ≙ SwiftUI `List` with `.listStyle(…)`. `insetGrouped` (both screens
 * since revision 3, R2-I: the staff history is the client's screen) runs
 * each section's rows as one segmented `ul[uiListGroup]`; `plain` sets
 * them on the page with no segment fill under headings that PIN under the
 * sheet's bar — the Wallet / Airbnb «Past trips» grammar, kept for a
 * dense list. Every heading is the DS's
 * list-section label (`ui-section-header uiHeaderProminence="standard"`),
 * an `h3` that names its list and carries `data-section-key` for the
 * client's scroll spy and jump pills.
 *
 * The list words only what is its own — the paging, the whole-list
 * failure and its retry («Опитай пак», the stack's one retry word). The
 * EMPTY is the host's: it projects `[visitListEmpty]` (the body, and an
 * action marked `uiActions` too), because only the host knows whether the
 * list is empty or merely filtered.
 *
 * Test ids are a family (`{prefix}-list`, `-skeleton`, `-error`,
 * `-retry`, `-empty`, `-more`, `-more-retry`, `-end`): the client keeps
 * `appointments-*`, the staff card reads `history-*` (R17).
 */
@Component({
  selector: 'lib-visit-list',
  imports: [
    NgTemplateOutlet,
    TranslocoDirective,
    UiButton,
    UiEmptyState,
    UiFrameDirective,
    UiListGroup,
    UiListRow,
    UiMultilineTextAlignmentDirective,
    UiNotice,
    UiRadiusDirective,
    UiSectionHeader,
    UiSkeleton,
    UiStack,
    UiTextDirective,
    VisitRow,
  ],
  templateUrl: './visit-list.html',
  styleUrl: './visit-list.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[attr.data-list-style]': 'listStyle()',
    '[attr.data-perspective]': 'perspective()',
  },
})
export class VisitList {
  readonly sections = input.required<readonly VisitSectionVm[]>();
  readonly perspective = input.required<VisitPerspective>();
  readonly listStyle = input<VisitListStyle>('insetGrouped');
  readonly state = input<VisitListState>('ready');
  /**
   * How many placeholder rows stand in while the first page loads — in
   * EACH group, when the host asks for more than one.
   */
  readonly skeletonRows = input(5);
  /**
   * How many placeholder groups stand in. One (the default) is a bare run
   * of rows; from two up each group stands under a placeholder of its
   * heading, the list's own shape: sections, each a heading and its rows
   * (revision 3 §2.5.3: two groups of two).
   */
  readonly skeletonGroups = input(1);
  readonly paging = input<VisitListPaging | null>(null);
  /**
   * Whether a row is a control. `null` is the perspective's own: the
   * client's rows are buttons, the staff's static (revision 3 §3.11).
   */
  readonly interactive = input<boolean | null>(null);
  /**
   * The family the list's own test ids belong to; null reads the
   * perspective's — `history` on the staff card, `appointments` on the
   * client's list.
   */
  readonly testIdPrefix = input<string | null>(null);
  /** A row was tapped: the appointment's id (a row that is a control only). */
  readonly openRow = output<string>();
  /** The next page, or the failed one again. */
  readonly loadMore = output<void>();
  /** The whole list, again, after it failed. */
  readonly retry = output<void>();

  protected readonly prefix = computed(
    () =>
      this.testIdPrefix() ??
      (this.perspective() === 'staff' ? 'history' : 'appointments'),
  );

  protected readonly plain = computed(() => this.listStyle() === 'plain');

  /**
   * The foot, when it has something to say: an end with no words draws
   * nothing, and neither does an end under no rows — «Това е всичко» under
   * a filter that left nothing closes a list that is not there. A page
   * still to read stays: an older one may hold what the filter asks for.
   */
  protected readonly foot = computed<VisitListPaging | null>(() => {
    const paging = this.paging();
    return paging === null ||
      (paging.kind === 'end' &&
        (!paging.endLabel || this.sections().length === 0))
      ? null
      : paging;
  });

  protected readonly placeholders = computed(() =>
    Array.from(
      { length: Math.max(0, Math.floor(this.skeletonRows())) },
      (_, index) => index,
    ),
  );

  /** The placeholder groups; a single one carries no heading. */
  protected readonly placeholderGroups = computed(() =>
    Array.from(
      { length: Math.max(1, Math.floor(this.skeletonGroups())) },
      (_, index) => index,
    ),
  );

  /** The heading's id — its list is labelled by it. */
  protected headingId(section: VisitSectionVm): string {
    return `visit-section-${section.key}`;
  }

  protected more(): void {
    const kind = this.paging()?.kind;
    if (kind === 'more' || kind === 'failed') this.loadMore.emit();
  }
}
