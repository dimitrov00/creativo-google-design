import {
  ChangeDetectionStrategy,
  Component,
  inject,
  input,
} from '@angular/core';
import { JournalFeed } from '@core/components';
import {
  UI_SHEET_HEADLINE,
  UiButton,
  UiChip,
  UiEmptyState,
  UiFlow,
  UiListGroup,
  UiListRow,
  UiNotice,
  UiSkeleton,
  UiStack,
} from '@creativo/ui/controls';
import {
  UiForegroundStyleDirective,
  UiFrameDirective,
  UiTextDirective,
  UiWeightDirective,
} from '@creativo/ui/modifiers';
import { ActivityList } from '../activity-list/activity-list';
import { ClientCardStore } from '../client-card.store';
import { LoadState, PagingState } from '@creativo/shared/view-state';
import { LEDGER_FILTER_WORDS } from '../client-card.words';

/** The four pills, in the toolbar's order. */
const KINDS: readonly JournalFeed[] = [
  JournalFeed.All,
  JournalFeed.Points,
  JournalFeed.Rewards,
  JournalFeed.Status,
];

/**
 * «ДВИЖЕНИЕ» — the ledger page (client-card-revision-3 §2.2.6, §3.16):
 * the journal whole, the newest first, grouped by month under quiet
 * headers that print the month's net when the month is wholly loaded.
 * Reached from the wallet's «История» disc and its «Всички ›».
 *
 * Under the large title and the quiet line («Георги Петров · **371 т.**»)
 * a toolbar of four chips narrows the kind («Всички», «Точки», «Награди»,
 * «Статус»); the chosen one is filled. The rows are the shared statement
 * (`lib-activity-list`, §2.2.5), then the foot: «Покажи още» while a
 * cursor is left (busy while a page is on its way, «Опитай пак» when one
 * did not come), «Това е всичко.» when none is.
 *
 * The body renders and computes nothing: the store's `ledger` is already
 * worded (`ledgerPageVm`), and the three things a tap does are the
 * store's (`setLedgerFilter`, `loadMoreLedger`, `retry('activity')`).
 * Empty under «Всички» is «Още няма движение.»; empty under a pill is
 * «Няма записи от този вид.» with the way back; a failed first page is
 * one notice with its retry; offline the saved rows stay and the foot is
 * absent while a cursor is left (the presenter's rule). History is never
 * frozen: a paused client's page reads as usual.
 */
@Component({
  selector: 'lib-client-ledger',
  imports: [
    ActivityList,
    UI_SHEET_HEADLINE,
    UiButton,
    UiChip,
    UiEmptyState,
    UiFlow,
    UiForegroundStyleDirective,
    UiFrameDirective,
    UiListGroup,
    UiListRow,
    UiNotice,
    UiSkeleton,
    UiStack,
    UiTextDirective,
    UiWeightDirective,
  ],
  templateUrl: './client-ledger.html',
  styleUrl: './client-ledger.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'data-testid': 'ledger-page' },
})
export class ClientLedgerPage {
  /** The `h2`'s id: the sheet's page container is labelled by it. */
  readonly titleId = input.required<string>();

  private readonly store = inject(ClientCardStore);
  protected readonly words = this.store.words;
  protected readonly online = this.store.online;
  protected readonly ledger = this.store.ledger;
  /** Where the first page's read stands, for the template's switch. */
  protected readonly LoadState = LoadState;
  /** Where the foot's next page stands, for the template's switch. */
  protected readonly PagingState = PagingState;

  protected readonly kinds = KINDS;
  /** The pill «Всички»: its empty state is the page's own, not a filter's. */
  protected readonly all = JournalFeed.All;
  /** Each pill's word: its i18n key and its `ledger-filter-{word}` test id, as before the flip. */
  protected readonly filterWords = LEDGER_FILTER_WORDS;
  /** Three month blocks of two rows, while the first page reads. */
  protected readonly placeholderMonths = [0, 1, 2] as const;
  protected readonly placeholderRows = [0, 1] as const;

  /** A pill: the first page under that kind, from the top. */
  protected setFilter(kind: JournalFeed): void {
    this.store.setLedgerFilter(kind);
  }

  /** «Покажи още»: the next page appends. */
  protected loadMore(): void {
    this.store.loadMoreLedger();
  }

  /** «Опитай пак»: the failed page — the first, or the next — again. */
  protected retry(): void {
    this.store.retry('activity');
  }
}
