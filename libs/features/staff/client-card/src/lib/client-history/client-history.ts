import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
} from '@angular/core';
import { VisitFilter, VisitPerspective } from '@core/systems';
import {
  VisitFilterMenu,
  VisitsBrowser,
} from '@creativo/features/shared/visits';
import { LoadState } from '@creativo/shared/view-state';
import {
  UI_SHEET_HEADLINE,
  UiButton,
  UiNotice,
  UiSkeleton,
} from '@creativo/ui/controls';
import {
  UiForegroundStyleDirective,
  UiFrameDirective,
  UiTextDirective,
  UiVisuallyHiddenDirective,
  UiWeightDirective,
} from '@creativo/ui/modifiers';
import { ClientCardStore } from '../client-card.store';
import type { LinePart } from '../client-pages.vm';
import { partedAtJoints } from '../client-card.format';

/**
 * One run of a quiet line as the template draws it: its words, its ink,
 * and the test id of the fact it prints — a fact that moved out of a tile
 * into a line keeps its id on the `span` that prints it (revision 3 §0.4).
 */
interface LineRun extends LinePart {
  readonly testId: string | null;
}

/**
 * One FACT of a quiet line — «24 посещения», «през 4 седмици», «похарчени
 * общо 492,50 €» — as its runs: what stands between two of the line's
 * joints, drawn as one item of the line (`fact-line.css`), so a line
 * that wraps parts between facts and no dot hangs at the break (review
 * 3, round 2).
 */
type LineFact = readonly LineRun[];

/** The facts of HB keep their cells' ids: `history-count-visits`, `-cadence`, `-noShows`, `-cancelled`. */
const COUNT_ID = 'history-count-';

/** HC's one fact is the ‹admin›'s sum. */
const SPEND_ID = 'history-spend';

/** The line's placeholder while the record is still unknown: one callout line's geometry. */
const LINE_PLACEHOLDER = {
  width: 'calc(var(--sys-space-unit) * 36)',
  height: 'calc(var(--sys-space-unit) * 5)',
} as const;

/**
 * «ПОСЕЩЕНИЯ» — a client's whole history on the staff card, REVISION 3
 * (client-card-revision-3 §2.5, R2-I; DV-D): the page «Всички ›» pushes.
 *
 * The test of this page is one sentence: put it beside
 * `/account/appointments` and it is the same screen. The title, the facts
 * under it, the month pills, the inset grouped list — the body under the
 * head is the SAME component the client's page mounts
 * (`lib-visits-browser`), so the two screens change together from now on.
 * What only staff see — the two quiet lines, the money, the status words,
 * «Този час», the marks, the paging, the funnel — arrives through the rows
 * and the inputs, never through a second list.
 *
 * The head is the page's `h2` (the sheet's `largeTitle`) and, where the
 * stats band stood, two quiet lines: HB «**23** посещения · през **4**
 * седмици» (`callout`, the figures in primary ink at weight 500, said to a
 * reader as one sentence) and HC «Без неявявания и откази от клиента ·
 * похарчени общо **492,50 €**» (`subheadline`; the sum an ‹admin›'s only;
 * absent when it has nothing to say). The page names no person: the bar's
 * way back does.
 *
 * The page computes nothing — `store.visits()` is worded, filtered,
 * sectioned and paged (`visits-page.presenter.ts`) — and every state is the
 * browser's own grammar: its pill and row placeholders while the first
 * page reads (the line's placeholder is the head's), its one notice and
 * «Опитай пак» when it failed, «Покажи още» / its ring / its retry at the
 * foot, the end «Първо посещение: 6.03.2025 г.». The funnel is pinned at
 * the pill rail's trailing end and stays when a filter leaves no section:
 * the way back out («Покажи всички») is under it. Offline, the saved rows
 * stay and «Покажи още» goes (a read that cannot answer). Rows stay static
 * (old R7; owner question Q6 may turn them into controls through the
 * browser's one input, and nothing else here changes).
 */
@Component({
  selector: 'lib-client-history',
  imports: [
    UI_SHEET_HEADLINE,
    UiButton,
    UiForegroundStyleDirective,
    UiFrameDirective,
    UiNotice,
    UiSkeleton,
    UiTextDirective,
    UiVisuallyHiddenDirective,
    UiWeightDirective,
    VisitFilterMenu,
    VisitsBrowser,
  ],
  templateUrl: './client-history.html',
  styleUrls: ['../fact-line.css', './client-history.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'data-testid': 'history-page' },
})
export class ClientHistoryPage {
  /** The `h2`'s id: the sheet's page container is labelled by it. */
  readonly titleId = input.required<string>();

  private readonly store = inject(ClientCardStore);
  protected readonly words = this.store.words;
  protected readonly online = this.store.online;
  protected readonly visits = this.store.visits;

  protected readonly placeholder = LINE_PLACEHOLDER;
  /** Whose list the browser and the funnel draw: the staff's. */
  protected readonly VisitPerspective = VisitPerspective;
  /** The funnel's way back out: «Покажи всички». */
  protected readonly VisitFilter = VisitFilter;

  /**
   * HB before the record is known: the line's placeholder. Once the
   * record is known the lines are said, read or not — a failed list keeps
   * them over its notice (P5-2 c).
   */
  protected readonly lineWaits = computed(
    () =>
      this.visits().loadState === LoadState.Loading &&
      this.visits().line.length === 0,
  );

  /**
   * HB's facts, each of its runs. The figures are the cells' facts in the
   * cells' order (visits, the interval, then the risks), so each keeps the
   * id its tile had; a line whose facts do not pair with the cells one to
   * one names none, rather than naming one wrong.
   */
  protected readonly line = computed<readonly LineFact[]>(() => {
    const vm = this.visits();
    const facts = vm.line.filter((run) => run.fact);
    const paired = facts.length === vm.cells.length;
    let index = 0;
    return partedAtJoints(
      vm.line.map((run) => ({
        ...run,
        testId:
          run.fact && paired
            ? `${COUNT_ID}${vm.cells[index++]?.id ?? ''}`
            : null,
      })),
    );
  });

  /** HC's facts: the sum is its one marked fact. */
  protected readonly facts = computed<readonly LineFact[] | null>(() => {
    const runs = this.visits().facts;
    return runs === null
      ? null
      : partedAtJoints(
          runs.map((run) => ({
            ...run,
            testId: run.fact ? SPEND_ID : null,
          })),
        );
  });

  /** A filter narrows the list: an empty list is the filter's, and says so. */
  protected readonly filtering = computed(
    () => this.visits().filter !== VisitFilter.All,
  );

  /**
   * The funnel only while it offers a choice that narrows the list, or a
   * narrowed list to widen again: a menu of «Всички» alone leads nowhere
   * (wave D r3; `offeredFilters` always holds the choice in force, P5-2 d).
   */
  protected readonly funnel = computed(() => {
    const vm = this.visits();
    return vm.offeredFilters.length > 1 || vm.filter !== VisitFilter.All;
  });

  protected setFilter(filter: VisitFilter): void {
    this.store.setHistoryFilter(filter);
  }

  /** The next page, or the failed one again (the browser's one output for both). */
  protected loadMore(): void {
    this.store.loadMoreHistory();
  }

  /** The whole list again, after its first page failed. */
  protected retry(): void {
    this.store.retry('history');
  }
}
