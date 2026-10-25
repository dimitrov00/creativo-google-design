import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
} from '@angular/core';
import {
  UI_SHEET_HEADLINE,
  UiAvatar,
  UiBadge,
  UiButton,
  UiCard,
  UiEmptyState,
  UiGauge,
  UiIcon,
  UiListGroup,
  UiListRow,
  UiNotice,
  UiSectionHeader,
  UiSkeleton,
  UiStack,
} from '@creativo/ui/controls';
import { StaffEventHead } from '@creativo/features/shared/visits';
import {
  UiForegroundStyleDirective,
  UiFrameDirective,
  UiRadiusDirective,
  UiTextDirective,
  UiVisuallyHiddenDirective,
} from '@creativo/ui/modifiers';
import { achievementsIdPrefix } from '../client-achievements/achievements-page-state';
import { ClientCardRegion } from '../client-card.contracts';
import { ClientCardStore } from '../client-card.store';
import {
  type RecordRowVm,
  type RecordTheme,
  type RecordsPageVm,
} from '../client-pages.vm';
import { LoadSlice, LoadState } from '@creativo/shared/view-state';
import { RECORD_KIND_WORDS } from '../client-card.words';

/** Where the page stands: the slice's state, the page's VM, or nothing to show (`EMPTY`). */
type RecordsState = LoadSlice.WithEmpty<RecordsPageVm>;

/** From this many characters a value is long: «6.03.2025 г.» is, «Фейд» and «24» are not. */
const LONG_FIGURE = 10;

/**
 * From this many a value is long on a PHONE's column too: «14.05.2025 г.»
 * (13, a two-digit day) beside «Първо посещение» broke the title inside
 * its phrase on a 390 phone's 355, where «8.03.2025 г.» (12) just held
 * (review 3, round 4).
 */
const LONG_FIGURE_PHONE = 13;

/**
 * From this many a value is long at EVERY width: «Класическа подстрижка»
 * beside its title left the title one word a line at 390 (review 3, F6);
 * a barber's name keeps the trailing edge where the column holds it.
 */
const LONG_FIGURE_ALWAYS = 16;

/**
 * How a row's value is placed: under the title on a narrow column, under
 * it on a phone's column too, under it everywhere, or at the trailing
 * edge. The stylesheet reads the word (`data-long`).
 */
type LongFigure = 'always' | 'phone' | 'narrow' | null;

/**
 * «РЕКОРДИ» (client-card-revision-3 §2.3.4; F11: "shouldn't this be on
 * top?") — the page «Постижения» opens for MORE than its 2 × 2: the
 * account's four records and five facts the card already reads, none of
 * which needs a new domain kind or a new read.
 *
 * The record set most recently is the hero: a white elevated card, its
 * emblem on the solid accent, the figure in the page's ONE display rung
 * (largeTitle 36/800), what it counts under it, the day it was set, the
 * capsule «Нов рекорд» within thirty days. Under it the rows by theme —
 * «Ритъм», «Посещения», «Любими» — inset grouped: a white disc with an
 * accent glyph (or the subject's picture, a barber's face) leads each
 * row, the figure stands at its trailing edge in the headline rung. The
 * featured record's row is not repeated in its group; a row whose datum
 * is absent is absent; a group without a row is absent. Last, «По години»:
 * one white card of a bar per year, the record year wearing the emblem —
 * drawn only when the loaded history is the client's whole history, so a
 * year is never under-counted.
 *
 * The rows are STATIC in this round (no state layer, no chevron): where
 * one would lead needs history filters that do not exist yet (§8.2).
 *
 * The VM is the store's (`store.records()`, the new `records.presenter`
 * over the achievements' data, the stats, the rule in force and the
 * loaded history); the page only orders, names and draws.
 */
@Component({
  selector: 'lib-client-records',
  imports: [
    StaffEventHead,
    UI_SHEET_HEADLINE,
    UiAvatar,
    UiBadge,
    UiButton,
    UiCard,
    UiEmptyState,
    UiForegroundStyleDirective,
    UiFrameDirective,
    UiGauge,
    UiIcon,
    UiListGroup,
    UiListRow,
    UiNotice,
    UiRadiusDirective,
    UiSectionHeader,
    UiSkeleton,
    UiStack,
    UiTextDirective,
    UiVisuallyHiddenDirective,
  ],
  templateUrl: './client-records.html',
  styleUrl: './client-records.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ClientRecordsPage {
  protected readonly store = inject(ClientCardStore);

  /** The id the editor's page container is labelled by: this page's `h2`. */
  readonly titleId = input.required<string>();

  protected readonly words = this.store.words;

  /**
   * The page's state from the store's slice: `null` (the flag off, a guest,
   * no account) and a page with nothing in it are the empty page; the
   * words gate the rest, as every page of the stack waits for them.
   */
  protected readonly state = computed((): RecordsState => {
    const slice = this.store.records();
    if (slice === null) return LoadSlice.empty;
    if (this.words() === null || slice.loadState === LoadState.Loading) {
      return LoadSlice.loading;
    }
    if (slice.loadState === LoadState.Failed) return LoadSlice.failed;
    const vm = slice.data;
    return vm.featured === null && vm.groups.length === 0
      ? LoadSlice.empty
      : LoadSlice.ready(vm);
  });

  protected readonly ready = computed(() => LoadSlice.dataOf(this.state()));

  /** Where the page stands, for the template's switch. */
  protected readonly LoadState = LoadState;
  /** Each record kind's word: the featured card's `data-kind`. */
  protected readonly recordKindWords = RECORD_KIND_WORDS;

  /** RB — the head's name: the VM's once drawn, the store's until then. */
  protected readonly subline = computed(
    () => this.ready()?.subline ?? this.store.displayName(),
  );

  /** Ids of the headings the groups and the years are named by, unique per mounted page. */
  protected readonly ids = (() => {
    const prefix = achievementsIdPrefix('records');
    return {
      group: (theme: RecordTheme) => `${prefix}-group-${theme}`,
      years: `${prefix}-years`,
    };
  })();

  /** One block, then two groups of two rows, while the reads are on their way. */
  protected readonly placeholderGroups = [0, 1] as const;
  protected readonly placeholderRows = [0, 1] as const;

  /** A row's quiet line as the event head takes it: one fact line, or none. */
  protected lines(row: RecordRowVm): readonly { readonly text: string }[] {
    return row.line === null ? [] : [{ text: row.line }];
  }

  /**
   * A LONG value — a date with its year — goes under its title on a narrow
   * column (§2.3.4: a 330 phone, the dialog's halves) rather than squeeze
   * the title into broken words; a longer date — a two-digit day — on a
   * phone's column too; a LONGER one — a service's name — under it at
   * every width; a figure or a short name keeps the trailing edge. The
   * stylesheet reads the word (`data-long`).
   */
  protected long(row: RecordRowVm): LongFigure {
    const { length } = row.figure;
    if (length >= LONG_FIGURE_ALWAYS) return 'always';
    if (length >= LONG_FIGURE_PHONE) return 'phone';
    return length >= LONG_FIGURE ? 'narrow' : null;
  }

  protected retry(): void {
    // The records ride the account's read (§2.3.4): region `loyalty`.
    this.store.retry(ClientCardRegion.Loyalty);
  }
}
