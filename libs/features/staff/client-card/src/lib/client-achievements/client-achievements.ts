import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  afterRenderEffect,
  computed,
  inject,
  input,
  output,
  untracked,
  viewChild,
} from '@angular/core';
import {
  UI_SHEET_HEADLINE,
  UiButton,
  UiCard,
  UiEmptyState,
  UiGauge,
  UiGrid,
  UiIcon,
  UiListGroup,
  UiListRow,
  UiMedal,
  UiNotice,
  UiSectionHeader,
  UiSkeleton,
  UiStack,
} from '@creativo/ui/controls';
import {
  UiFrameDirective,
  UiRadiusDirective,
  UiTextDirective,
} from '@creativo/ui/modifiers';
import { AchievementCategoryPage } from '../achievement-category/achievement-category';
import { AchievementChips } from '../achievement-chips/achievement-chips';
import type { AchievementScope } from '../client-card.contracts';
import { ClientCardStore } from '../client-card.store';
import type {
  AchievementTileVm,
  MedalSectionVm,
  MedalsPageVm,
} from '../client-pages.vm';
import {
  CHIP_ALL,
  CHIP_SEASONS,
  medalsPageVm,
  sectionTilesShown,
} from '../medals.presenter';
import { RecordCard } from '../record-card/record-card';
import { familyGridOf, medalGridOf, recordColumnsOf } from '../sheet-width';
import { AchievementTile } from './achievement-tile';
import {
  achievementsIdPrefix,
  achievementsPageState,
} from './achievements-page-state';

/**
 * «ПОСТИЖЕНИЯ» — the collection, one push from the glance
 * (client-card-revision-3 §2.3; R2-G). Records FIRST: the account's four
 * as white elevated cards, 2 × 2, with «Всички ›» to «Рекорди». Then the
 * category band, in flow (§3.9), which FILTERS everything under it:
 *
 * - «Всички»: «Почти спечелени» (one row of three), the running season
 *   and the events as cards, the collection ring, every category as a
 *   GRID — three columns on a phone, four from 600, six in the dialog,
 *   never a rail — folded past nine families to two rows and «Покажи
 *   всички N», and one lone row to the archive;
 * - a category: that category alone, whole and sub-sectioned, the built
 *   scope body mounted in place (`lib-achievement-category` embedded);
 * - «Сезони»: the season, the events, the archive.
 *
 * The page computes its VM from the store's data through the pure
 * presenter (`medalsPageVm`), over the chip the STORE holds
 * (`store.medalsChip()`): ‹ from a medal's detail returns to the same chip,
 * and the glance's and a detail's «Всички ›» choose a chip before the push
 * (§5.2). Every module is a DS piece; this component only orders them,
 * names them and says where a tap goes: a medal opens its family
 * (`openMedal`), a record card and the records' «Всички» open «Рекорди»
 * (`openRecords`), the season card, an event and the archive row open a
 * scope (`openScope`).
 */
@Component({
  selector: 'lib-client-achievements',
  imports: [
    AchievementCategoryPage,
    AchievementChips,
    AchievementTile,
    RecordCard,
    UI_SHEET_HEADLINE,
    UiButton,
    UiCard,
    UiEmptyState,
    UiFrameDirective,
    UiGauge,
    UiGrid,
    UiIcon,
    UiListGroup,
    UiListRow,
    UiMedal,
    UiNotice,
    UiRadiusDirective,
    UiSectionHeader,
    UiSkeleton,
    UiStack,
    UiTextDirective,
  ],
  templateUrl: './client-achievements.html',
  styleUrl: './client-achievements.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ClientAchievementsPage {
  protected readonly store = inject(ClientCardStore);

  /** The id the editor's page container is labelled by: this page's `h2`. */
  readonly titleId = input.required<string>();

  /** The season card, an event, the archive row; a day or a season from the embedded category. */
  readonly openScope = output<AchievementScope>();
  /** A medal on a grid: its family's detail. */
  readonly openMedal = output<string>();
  /** A record card, or the records' «Всички ›»: «Рекорди». */
  readonly openRecords = output<void>();

  /** The band: what «Покажи всички N» and a page opened on a chip scroll under the bar. */
  private readonly band = viewChild<AchievementChips, ElementRef<HTMLElement>>(
    AchievementChips,
    { read: ElementRef },
  );

  /** The chip in force, the store's: `all` for a new person. */
  protected readonly chip = this.store.medalsChip;

  /**
   * The chip the page was OPENED on (the glance's and a detail's «Всички ›»
   * choose one before the push, §5.2): the band lands under the bar once
   * it is drawn — which may be a read later than the first render.
   */
  private readonly openedOn = untracked(this.store.medalsChip);
  private landed = false;

  protected readonly state = computed(() =>
    achievementsPageState<MedalsPageVm>(
      this.store.achievementsData(),
      this.store.achievementsContext(),
      (data, ctx) =>
        medalsPageVm(data, ctx, this.chip(), {
          // `loyalty.streaks` off hides the rhythm as a rule that is off
          // does (§2.3.5): the store hands no rule over then (S1-4).
          rhythm: this.store.rhythmRule() !== null,
        }),
    ),
  );

  /** The page once it can be drawn: its VM and the words it was built in. */
  protected readonly ready = computed(() => {
    const state = this.state();
    return state.kind === 'ready' ? state : null;
  });

  /** The words for what shows before the page is ready: the head and the notices. */
  protected readonly words = this.store.words;

  /**
   * The chip the page DRAWS: the store's, or «Всички» for a chip the
   * catalogue no longer offers (the presenter falls back the same way).
   */
  protected readonly chosen = computed((): string => {
    const page = this.ready();
    const chip = this.chip();
    if (page === null) return chip;
    return page.vm.chips.some((c) => c.id === chip) ? chip : CHIP_ALL;
  });

  /** The chip «Всички»: the overview under the band. */
  protected readonly overview = computed(() => this.chosen() === CHIP_ALL);

  /** A category chosen: the scope its body is mounted on, in place; `null` on the overview and under «Сезони». */
  protected readonly categoryScope = computed((): AchievementScope | null => {
    const chosen = this.chosen();
    return chosen === CHIP_ALL || chosen === CHIP_SEASONS
      ? null
      : { kind: 'category', categoryId: chosen };
  });

  /** Ids of the headings the grids are named by, unique per mounted page. */
  protected readonly ids = (() => {
    const prefix = achievementsIdPrefix('achievements');
    return {
      records: `${prefix}-records`,
      chips: `${prefix}-chip`,
      close: `${prefix}-close`,
      shelf: (section: MedalSectionVm) =>
        `${prefix}-shelf-${section.categoryId}`,
    };
  })();

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  /** The medal grids' step for the column the page is laid in: 3 · 4 · 6 columns, the card's padding, the gaps. */
  protected readonly grid = medalGridOf(this.host);

  /** The season's and an event's card: three families across a phone (the card's padding given to the tiles on a 330), four from 600 and in the dialog. */
  protected readonly familyGrid = familyGridOf(this.host);

  /**
   * The records: 2 × 2 on a phone AND in the ≥ 761 dialog (four across
   * its 528 pt column cramped every card to 120, review 3, round 2); four
   * in one row only where a card keeps 150 — a column of 648 and up
   * (sheet-width.ts).
   */
  protected readonly recordColumns = recordColumnsOf(this.host);

  /** Four record blocks, two rows of chips, six discs while the reads are on their way. */
  protected readonly placeholderRecords = [0, 1, 2, 3] as const;
  protected readonly placeholderChips = [0, 1, 2, 3, 4, 5, 6] as const;
  protected readonly placeholderDiscs = [0, 1, 2, 3, 4, 5] as const;

  constructor() {
    // Opened on a chip (the glance's and a detail's «Всички ›», §5.2): the
    // band lands under the bar as soon as it is drawn (the page may still
    // be loading at its first render), once; the body under it is that
    // chip's.
    afterRenderEffect(() => {
      if (this.landed || this.band() === undefined) return;
      this.landed = true;
      if (this.openedOn !== CHIP_ALL) this.scrollBandUnderBar();
    });
  }

  /** AL — the tiles the overview draws of a section: all, or a folded one's first two rows on the grid's columns. */
  protected shown(section: MedalSectionVm): readonly AchievementTileVm[] {
    return section.tiles.slice(
      0,
      sectionTilesShown(section, this.grid().columns),
    );
  }

  protected open(tile: AchievementTileVm): void {
    if (tile.opens === null) this.openMedal.emit(tile.medal.seriesId);
    else this.openScope.emit(tile.opens);
  }

  protected openSeason(seasonId: string): void {
    this.openScope.emit({ kind: 'season', seasonId });
  }

  protected openArchive(): void {
    this.openScope.emit({ kind: 'archive' });
  }

  /** AM — «Покажи всички N»: the category's chip is chosen, and the band scrolls under the bar. */
  protected showAll(categoryId: string): void {
    this.store.setMedalsChip(categoryId);
    this.scrollBandUnderBar();
  }

  protected retry(): void {
    this.store.retry('achievements');
  }

  /**
   * The band under the bar, clear of its fade: its own `scroll-margin`
   * is the sheet's clearance (§3.9). After the frame that draws the chosen
   * chip's body, so the scroller has its new height to scroll in.
   */
  private scrollBandUnderBar(): void {
    const band = this.band();
    if (band === undefined) return;
    requestAnimationFrame(() => {
      // jsdom has no scrollIntoView: a spec that opens the page on a chip
      // must not throw after its case (X1-5).
      if (typeof band.nativeElement.scrollIntoView === 'function') {
        band.nativeElement.scrollIntoView({ block: 'start' });
      }
    });
  }
}
