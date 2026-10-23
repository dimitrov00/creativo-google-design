import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
} from '@angular/core';
import { TranslocoService } from '@jsverse/transloco';
import { VisitPerspective } from '@core/systems';
import {
  type RhythmRuleWords,
  VisitRow,
  rhythmRuleWords,
} from '@creativo/features/shared/visits';
import {
  UI_SHEET_HEADLINE,
  UiAvatar,
  UiAvatarGroup,
  UiBadge,
  UiButton,
  UiCard,
  UiEmptyState,
  UiGrid,
  UiIcon,
  UiListGroup,
  UiMedal,
  UiMediaCard,
  UiMetric,
  UiNotice,
  UiSectionHeader,
  UiSkeleton,
  UiStack,
} from '@creativo/ui/controls';
import {
  UiForegroundStyleDirective,
  UiFrameDirective,
  UiTextDirective,
  UiWeightDirective,
} from '@creativo/ui/modifiers';
import { LoadSlice, LoadState } from '@creativo/shared/view-state';
import { AchievementTile } from '../client-achievements/achievement-tile';
import {
  achievementsIdPrefix,
  achievementsPageState,
} from '../client-achievements/achievements-page-state';
import { ClientCardStore } from '../client-card.store';
import type {
  AchievementTileVm,
  DetailFaceVm,
  DetailHowVm,
  DetailPictureVm,
  MedalDetailVm,
  MedalProgressVm,
} from '../client-pages.vm';
import { medalDetailVm } from '../medal-detail.presenter';

/** DF — the who line shows this many faces; the rest are the group's «+N». */
const FACES_SHOWN = 3;

/**
 * ONE MEDAL FAMILY (client-card revision 3 §2.4, R2-H) — a medal's page
 * as a game draws a badge's: the art large on a stage of ITS own (the
 * hero head, `uiMediaStage`, the medal `extraLarge` wearing its own ring),
 * the family's title under it, where it stands in one quiet line; then
 * six blocks, EACH FACT ONCE. The count lives in the progress card and
 * nowhere else (`ui-metric` at the page's one hero rung); «Как се печели»
 * is ONE sentence chosen by the family's metric, the pictures of what
 * counts, who and where, the exclusion; «Нива» is a ladder of MEDALS,
 * each level's threshold, reward and day; «Броени посещения» the shared
 * staff rows; «Още от …» one grid row of three neighbours, never a rail.
 *
 * The page's one verb («Добави фейд») is NOT here: the editor's dock
 * draws it for this page kind (DV-C, §5.2), and the store answers it
 * (`detailAction`). The body carries the verb in its VM only so the
 * presenter can withhold it from a family that cannot move.
 *
 * Pure over the store: `medalDetailVm` runs over `achievementsData()` and
 * `achievementsContext()` (the built pattern of the achievements bodies),
 * handed the loaded history, the rows' input, the rhythm's rule worded and
 * the dock's verb. A neighbour's tap emits `openMedal`, and the editor
 * REPLACES this page with it (same depth, same way back); «Всички» emits
 * `openCategory`, and the editor opens «Постижения» on that chip.
 *
 * Not `ui-detail-sheet`: that is a second modal sheet; this is a page
 * pushed inside the visit sheet, so it takes that sheet's head.
 */
@Component({
  selector: 'lib-achievement-detail',
  imports: [
    AchievementTile,
    UI_SHEET_HEADLINE,
    UiAvatar,
    UiAvatarGroup,
    UiBadge,
    UiButton,
    UiCard,
    UiEmptyState,
    UiForegroundStyleDirective,
    UiFrameDirective,
    UiGrid,
    UiIcon,
    UiListGroup,
    UiMedal,
    UiMediaCard,
    UiMetric,
    UiNotice,
    UiSectionHeader,
    UiSkeleton,
    UiStack,
    UiTextDirective,
    UiWeightDirective,
    VisitRow,
  ],
  templateUrl: './achievement-detail.html',
  styleUrl: './achievement-detail.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AchievementDetailPage {
  protected readonly store = inject(ClientCardStore);
  private readonly transloco = inject(TranslocoService);

  /** The id the editor's page container is labelled by: this page's `h2`. */
  readonly titleId = input.required<string>();
  /** The family: a `BadgeSeries` id. */
  readonly seriesId = input.required<string>();

  /** A neighbour's medal: the editor replaces this page with its detail. */
  readonly openMedal = output<string>();
  /** «Всички» under «Още от …»: the editor opens «Постижения» on this category's chip. */
  readonly openCategory = output<string>();

  /**
   * The rhythm's rule in force, worded for the rhythm family's «Как се
   * печели» (§2.4.3). The store publishes the rule's summary and the
   * card's language; the words are the shared visits lib's, read through
   * the catalogue as the store's own translate does. `null` until both are
   * known, or with the rhythm off.
   */
  protected readonly rule = computed((): RhythmRuleWords | null => {
    const summary = this.store.rhythmRule();
    const words = this.store.words();
    if (summary === null || words === null) return null;
    const lang = words.lang;
    return rhythmRuleWords(
      summary,
      (key, params) => this.transloco.translate(key, params, lang),
      lang,
    );
  });

  protected readonly state = computed(() => {
    const seriesId = this.seriesId();
    return achievementsPageState<MedalDetailVm>(
      this.store.achievementsData(),
      this.store.achievementsContext(),
      (data, ctx) =>
        medalDetailVm(seriesId, data, ctx, {
          visits: this.store.loadedVisits(),
          subjectCustomerId: this.store.customerId(),
          rule: this.rule(),
          rows: this.store.visitRowsInput(),
          action: this.store.detailAction(seriesId),
        }),
    );
  });

  protected readonly ready = computed(() => LoadSlice.dataOf(this.state()));

  /** Where the page stands, for the template's switch. */
  protected readonly LoadState = LoadState;
  /** Whose rows the counted visits are: the staff's. */
  protected readonly VisitPerspective = VisitPerspective;

  /**
   * The hero head with its stage: while the family is on its way and once
   * it is drawn. A page with nothing to stand on the stage (the read
   * failed, a family the catalogue lacks, no account) takes the standard
   * head: the hero keeps its 128 media box even without a face, and the
   * bar's word would float under an empty box.
   */
  protected readonly hero = computed(() => {
    const loadState = this.state().loadState;
    return loadState === LoadState.Ready || loadState === LoadState.Loading;
  });

  protected readonly words = this.store.words;

  /** The family's title once drawn; the bar's word for it before that. */
  protected readonly title = computed(
    () =>
      this.ready()?.vm.title ??
      this.store.barTitle('achievementDetail', this.seriesId()) ??
      this.words()?.achievements.title ??
      '',
  );

  /** The headings the page's modules are labelled by, unique per instance. */
  protected readonly ids = (() => {
    const prefix = achievementsIdPrefix('achievements-detail');
    return {
      progress: `${prefix}-progress`,
      how: `${prefix}-how`,
      levels: `${prefix}-levels`,
      visits: `${prefix}-visits`,
      related: `${prefix}-related`,
    } as const;
  })();

  /** «23 от 25 посещения с фейд» — the metric's one name; the card is the group it names. */
  protected progressName(progress: MedalProgressVm): string {
    return [progress.value, progress.unit, progress.what]
      .filter((part): part is string => part !== null)
      .join(' ');
  }

  /** DF — the covers with art: no art, no cover (§2.4.4). */
  protected picturesWithArt(how: DetailHowVm): readonly DetailPictureVm[] {
    return how.pictures.filter((picture) => picture.src !== null);
  }

  /** The covers' grid never holds an empty track: one cover stands alone across the card. */
  protected coverColumns(
    how: DetailHowVm,
    pictures: readonly DetailPictureVm[],
  ): number {
    return Math.min(how.columns, Math.max(1, pictures.length));
  }

  protected facesShown(how: DetailHowVm): readonly DetailFaceVm[] {
    return how.faces.slice(0, FACES_SHOWN);
  }

  protected facesOverflow(how: DetailHowVm): number {
    return Math.max(0, how.faces.length - FACES_SHOWN);
  }

  /** The group names everyone, as the avatar group asks (its discs are decoration). */
  protected facesName(how: DetailHowVm): string {
    return how.faces.map((face) => face.name).join(', ');
  }

  protected open(tile: AchievementTileVm): void {
    this.openMedal.emit(tile.medal.seriesId);
  }

  protected retry(): void {
    this.store.retry('achievements');
  }
}
