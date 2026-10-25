import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  booleanAttribute,
  computed,
  inject,
  input,
  output,
} from '@angular/core';
import {
  UI_SHEET_HEADLINE,
  UiButton,
  UiCard,
  UiEmptyState,
  UiGauge,
  UiGrid,
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
import { LoadSlice, LoadState } from '@creativo/shared/view-state';
import { achievementScopeKey } from '../achievements.presenter';
import {
  type AchievementScope,
  ClientCardPage,
  ClientCardRegion,
} from '../client-card.contracts';
import { ClientCardStore } from '../client-card.store';
import type {
  AchievementTileVm,
  ScopePageVm,
  ScopeSectionVm,
} from '../client-pages.vm';
import { medalScopeVm } from '../medals.presenter';
import { medalGridOf } from '../sheet-width';
import { AchievementTile } from '../client-achievements/achievement-tile';
import {
  achievementsIdPrefix,
  achievementsPageState,
} from '../client-achievements/achievements-page-state';

/**
 * ONE SCOPE OF THE COLLECTION (client-card-revision-3 §2.3.3) — one body
 * for what the collection opens or filters to: a CATEGORY (sectioned by
 * what its families are about: mastery by the service's own category,
 * the barbers' shelf by barbers and shops, so forty services never become
 * one wall of identical discs), a SEASON or an event (its medal over its
 * step track above the grid; an ended one lists only what was earned and
 * the day it closed), the ARCHIVE of ended seasons and events (by the
 * year each closed, each opening its own season), and a DAY of what was
 * earned (the levels earned on it).
 *
 * A category is no longer pushed: it is a CHIP of «Постижения», and this
 * body is mounted in place under the band (`embedded`): no headline of
 * its own then, only the category's summary line («Майсторство · 3 от 9
 * спечелени») over its grids. The season, the archive and a day stay
 * pushed pages, titled by the sheet's large title.
 *
 * The VM is computed from the store's data and the scope through the pure
 * presenter (`medalScopeVm`: the built scope page, every medal in its
 * ring). Every section's grid is a white elevated card on the medal
 * grid's STEP (§2.3.2 «Grid metrics»: three columns on a phone, four from
 * 600, six in the dialog; the card's padding and the gaps by the step),
 * so a section of one or two families keeps its medals in the columns of
 * the sections above it. Each grid is a list of medals named by its
 * section's heading or, unlabelled, by the page's title. A family opens
 * its detail (`openMedal`); an archived season opens its own scope
 * (`openScope`).
 */
@Component({
  selector: 'lib-achievement-category',
  imports: [
    AchievementTile,
    UI_SHEET_HEADLINE,
    UiButton,
    UiCard,
    UiEmptyState,
    UiFrameDirective,
    UiGauge,
    UiGrid,
    UiMedal,
    UiNotice,
    UiRadiusDirective,
    UiSectionHeader,
    UiSkeleton,
    UiStack,
    UiTextDirective,
  ],
  templateUrl: './achievement-category.html',
  styleUrl: './achievement-category.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[attr.data-embedded]': "embedded() ? '' : null" },
})
export class AchievementCategoryPage {
  protected readonly store = inject(ClientCardStore);

  /** The id the editor's page container is labelled by: this page's `h2`. */
  readonly titleId = input.required<string>();
  /** What the page shows: a category, a season, the archive or a day. */
  readonly scope = input.required<AchievementScope>();
  /**
   * Mounted in place under the chips of «Постижения» (a category): no
   * headline, no offline notice of its own (the page above draws them);
   * the summary line, then the grids.
   */
  readonly embedded = input(false, { transform: booleanAttribute });

  /** A family on the grid: its detail. */
  readonly openMedal = output<string>();
  /** A season in the archive: its own scope (depth 4). */
  readonly openScope = output<AchievementScope>();

  protected readonly state = computed(() => {
    const scope = this.scope();
    return achievementsPageState<ScopePageVm>(
      this.store.achievementsData(),
      this.store.achievementsContext(),
      (data, ctx) =>
        medalScopeVm(data, scope, ctx, {
          // `loyalty.streaks` off hides the rhythm as a rule that is off
          // does (§2.3.5): the store hands no rule over then (S1-4).
          rhythm: this.store.rhythmRule() !== null,
        }),
    );
  });

  protected readonly ready = computed(() => LoadSlice.dataOf(this.state()));

  /** Where the page stands, for the template's switch. */
  protected readonly LoadState = LoadState;

  protected readonly words = this.store.words;

  /**
   * The `h2`: the scope's own title once drawn; before that the bar's
   * (the archive and a day are titled without data), else the
   * collection's name.
   */
  protected readonly title = computed(
    () =>
      this.ready()?.vm.title ??
      this.store.barTitle(
        ClientCardPage.AchievementCategory,
        achievementScopeKey(this.scope()),
      ) ??
      this.words()?.achievements.title ??
      '',
  );

  /** «Майсторство · 3 от 9 спечелени» · a season's dates; the person until then. */
  protected readonly subline = computed(
    () => this.ready()?.vm.subline ?? this.store.displayName(),
  );

  private readonly idPrefix = achievementsIdPrefix('achievements-scope');

  /**
   * The medal grids' step for the column the page is laid in (§2.3.2
   * «Grid metrics»): three columns on a phone, four from 600, six in the
   * dialog; the card's padding and the gaps by the step.
   */
  protected readonly grid = medalGridOf(inject(ElementRef));

  /** The heading a section's grid is named by; an unlabelled grid is named by the page's title. */
  protected sectionLabel(section: ScopeSectionVm): string {
    return section.title === null
      ? this.titleId()
      : `${this.idPrefix}-${section.key}`;
  }

  /** Six discs while a scope's families are on their way. */
  protected readonly placeholderDiscs = [0, 1, 2, 3, 4, 5] as const;

  protected open(tile: AchievementTileVm): void {
    if (tile.opens === null) this.openMedal.emit(tile.medal.seriesId);
    else this.openScope.emit(tile.opens);
  }

  protected retry(): void {
    this.store.retry(ClientCardRegion.Achievements);
  }
}
