import { NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
} from '@angular/core';
import type { VisitLeg } from '@core/components';
import { VisitCard } from '@creativo/features/shared/visits';
import {
  UI_SHEET_HEADLINE,
  UiAvatar,
  UiBadge,
  UiButton,
  UiCouponCard,
  UiFlow,
  UiGrid,
  UiIcon,
  UiListGroup,
  UiListRow,
  UiMediaCard,
  UiNotice,
  UiQuickAction,
  UiQuickActions,
  UiSectionHeader,
  UiSkeleton,
  UiStack,
} from '@creativo/ui/controls';
import {
  UiForegroundStyleDirective,
  UiFrameDirective,
  UiInteractiveDirective,
  UiRadiusDirective,
  UiTextDirective,
  UiVisuallyHiddenDirective,
  UiWeightDirective,
} from '@creativo/ui/modifiers';
import { BirthdayCard } from '../birthday-card/birthday-card';
import type { ClientCardRegion, WalletAnchor } from '../client-card.contracts';
import { figure, partedAtJoints } from '../client-card.format';
import { ClientCardStore } from '../client-card.store';
import { type ClientPhotoVm, type LinePart } from '../client-pages.vm';
import { LoadState } from '@creativo/shared/view-state';
import { LoyaltyGlance } from '../loyalty-glance/loyalty-glance';
import { MedalsGlance } from '../medals-glance/medals-glance';
import { regularSheetWidth } from '../sheet-width';

/** A module of the glance that reads data of its own, and can fail on its own. */
type GlanceModule = Exclude<
  ClientCardRegion,
  'profile' | 'history' | 'vouchers' | 'activity'
>;

/** The photo grid: ONE row of three on a phone, two rows of five in the ≥ 761 dialog (§2.1.3 I1). */
const PHOTO_COLUMNS = { compact: 3, regular: 5 } as const;
const PHOTO_ROWS = { compact: 1, regular: 2 } as const;

/**
 * The placeholders' geometry (§2.1.5 Loading): each module one block shaped
 * like what lands in it, so the page never jumps when the reads answer.
 * The heights are the DS pieces' own, measured at 390 (D4-5, V1, §2.1.3).
 */
const PLACEHOLDER = {
  /** E — a ticket without a figure (124). */
  ticket: 'calc(var(--sys-space-unit) * 31)',
  /** H — one visit card: label, services, facts (117). */
  visitCard: 'calc(var(--sys-space-unit) * 29.25)',
  /** F — the loyalty card: figure, sentence, holdings (128). */
  loyaltyCard: 'calc(var(--sys-space-unit) * 32)',
  /** G — the medals card: three large medals, the cue, the records line (214). */
  medalsCard: 'calc(var(--sys-space-unit) * 53.5)',
  /** The count or «Всички» a heading's action will read. */
  actionWidth: 'calc(var(--sys-space-unit) * 10)',
  actionHeight: 'calc(var(--sys-space-unit) * 5)',
} as const;

/**
 * THE GLANCE PAGE «client» (client-card-revision-3 §2.1) — who the person
 * is, how to reach them, the reward to use now, what was done last time
 * and what comes next, then their loyalty, their achievements and their
 * past cuts, and the one way to take them off the visit. The barber's
 * three-second questions, in that order.
 *
 * THE HEAD is a centred HERO (R2-C): the face at 112 in a ring box of 128
 * that rises 37 into the bar's row, the tier as a white plate on the ring's
 * rim and the ring itself the progress to the next tier (a paused client's
 * warning ring takes its place), the name as the page's one `h2`
 * (`uiSheetLargeTitle`, `title` 28/700 — the only 28 on the page), one
 * quiet line 4 under it whose facts are primary ink. The ring and the plate
 * are the headline's and `aria-hidden`; a visually hidden span says them in
 * words after the line.
 *
 * EVERY MODULE is a heading over a WHITE ELEVATED surface (R2-E), 32
 * apart: the birthday as a solid band — the page's ONE orange slab — before
 * the verbs; the verbs as round discs with their word under them, the
 * repeat verb promoted; the ready reward as a white ticket wearing the
 * decorative pill; the visits as the `/account` card, one shape and one
 * order for the last visit, the next one and a waiting request; the
 * loyalty as ONE card and ONE button to the wallet; the medals as three
 * named rings in a grid with the cue and the records line; the photos as a
 * grid of three, never a rail; one list group, the exits.
 *
 * A module is ABSENT when its slice is (a flag off, no account, a guest,
 * nothing to show); while its read runs it holds a placeholder shaped like
 * its content; when its read fails its heading stays over one compact
 * «Опитай пак» notice — two or more failures fold into one notice under
 * the head. A failed profile is the whole card's failure: the head, one
 * notice, the verbs and the exits.
 *
 * The page computes nothing: the store's `hero` and `overview` are already
 * worded. It writes nothing either — every act is an output the visit
 * editor turns into a push, a draft change or a pop.
 */
@Component({
  selector: 'lib-client-card',
  imports: [
    BirthdayCard,
    LoyaltyGlance,
    MedalsGlance,
    NgTemplateOutlet,
    UI_SHEET_HEADLINE,
    UiAvatar,
    UiBadge,
    UiButton,
    UiCouponCard,
    UiFlow,
    UiForegroundStyleDirective,
    UiFrameDirective,
    UiGrid,
    UiIcon,
    UiInteractiveDirective,
    UiListGroup,
    UiListRow,
    UiMediaCard,
    UiNotice,
    UiQuickAction,
    UiQuickActions,
    UiRadiusDirective,
    UiSectionHeader,
    UiSkeleton,
    UiStack,
    UiTextDirective,
    UiVisuallyHiddenDirective,
    UiWeightDirective,
    VisitCard,
  ],
  templateUrl: './client-card.html',
  styleUrls: ['../fact-line.css', './client-card.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    'data-testid': 'client-card',
    '[attr.data-sheet-width]': "wide() ? 'regular' : 'compact'",
  },
})
export class ClientCard {
  /** The `h2`'s id: the sheet's page container is labelled by it. */
  readonly titleId = input.required<string>();

  /** Where each module's read stands, for the template's switches. */
  protected readonly LoadState = LoadState;

  /** The loyalty card and «Всички»: the wallet at its top (`null`). The anchors stay for the editor's binding. */
  readonly openLoyalty = output<WalletAnchor | null>();
  /** «38 ›»: the achievements collection. */
  readonly openAchievements = output<void>();
  /** A medal of the card: its family's detail (the series id). */
  readonly openMedal = output<string>();
  /** The records line: «Рекорди». */
  readonly openRecords = output<void>();
  /** «23 ›»: the history. */
  readonly openHistory = output<void>();
  /** A past cut, from the grid or the last visit's thumbs (the photo id). */
  readonly openPhoto = output<string>();
  /** A ticket's «Използвай» (the reward's, the birthday gift's): the sheet puts that grant on the bill and opens the discount page on it. */
  readonly openReward = output<string>();
  /** An applied ticket's «Премахни»: the sheet takes that grant off the bill, as the discount page's card does. */
  readonly removeReward = output<string>();
  /** «Повтори»: the last visit's services, for the draft. */
  readonly repeatLast = output<readonly VisitLeg[]>();
  /** «Махни от посещението». */
  readonly removeClient = output<void>();

  private readonly store = inject(ClientCardStore);
  protected readonly words = this.store.words;
  protected readonly hero = this.store.hero;
  protected readonly overview = this.store.overview;
  protected readonly online = this.store.online;

  protected readonly placeholder = PLACEHOLDER;

  /** The ≥ 761 centred dialog: two cards to a row, five photos to a row. */
  protected readonly wide = regularSheetWidth();

  /**
   * A5 — the quiet line as a reader hears it: the sentence, its joints
   * and all («Клиент от март 2025 г. · идва през 4 седмици»).
   */
  protected readonly lineName = computed(() => {
    const line = this.hero().line;
    return line === null ? null : line.map((part) => part.text).join('');
  });

  /**
   * A5 — the line as the page draws it: its FACTS, each as its runs,
   * parted at the presenter's joints (`fact-line.css` draws the dots, and
   * only between two facts on one line): «Клиент от **март 2025 г.**» ·
   * «идва през **4 седмици**».
   */
  protected readonly facts = computed(
    (): readonly (readonly LinePart[])[] | null => {
      const line = this.hero().line;
      return line === null ? null : partedAtJoints(line);
    },
  );

  /** A2 — the paused client's WARNING ring on the face; it wins over the tier's arc. */
  protected readonly mediaTone = computed(() =>
    this.hero().paused ? ('warning' as const) : null,
  );

  /** A2 — the tier ring: progress to the next tier; `null` keeps the box and draws none. */
  protected readonly ringValue = computed(
    () => this.hero().tier?.progress ?? null,
  );

  /** S7: `users/{uid}` did not load — the head, one notice, the verbs and the exits. */
  protected readonly profileFailed = computed(() =>
    this.overview().failed.includes('profile'),
  );

  /** The modules whose read failed. */
  private readonly failedModules = computed(() =>
    this.overview().failed.filter(
      (region): region is GlanceModule =>
        region !== 'profile' &&
        region !== 'history' &&
        region !== 'vouchers' &&
        region !== 'activity',
    ),
  );

  /** Two or more failed: one notice under the head, headings alone in the modules. */
  protected readonly failuresFolded = computed(
    () => this.failedModules().length >= 2,
  );

  /** H0 — «23 ›» and the sentence it is named by; `null` until the module is ready. */
  protected readonly visitsAction = computed(() => {
    const slice = this.overview().visits;
    const words = this.words();
    if (slice?.loadState !== LoadState.Ready || words === null) {
      return null;
    }
    const count = slice.data.count;
    return {
      figure: figure(count, words.lang),
      name: words.visitsModule.allName(count),
    };
  });

  /** G0 — «38 ›» and its sentence; `null` until the module is ready. */
  protected readonly achievementsAction = computed(() => {
    const slice = this.overview().medals;
    const words = this.words();
    if (slice?.loadState !== LoadState.Ready || words === null) {
      return null;
    }
    const count = slice.data.levelCount;
    return {
      figure: figure(count, words.lang),
      name: words.achievements.allName(count),
    };
  });

  /** H — the cards pad `comfortable` on a phone, `regular` where two share a row (V1-7). */
  protected readonly cardPadding = computed(() =>
    this.wide() ? ('regular' as const) : ('comfortable' as const),
  );

  /** I1 — three columns on a phone, five in the dialog. */
  protected readonly photoColumns = computed(() =>
    this.wide() ? PHOTO_COLUMNS.regular : PHOTO_COLUMNS.compact,
  );

  /** I1 — the newest cuts that fill the grid's rows: three on a phone, ten in the dialog. */
  protected readonly shownPhotos = computed((): readonly ClientPhotoVm[] => {
    const photos = this.overview().photos;
    if (photos?.loadState !== LoadState.Ready) return [];
    const rows = this.wide() ? PHOTO_ROWS.regular : PHOTO_ROWS.compact;
    return photos.data.slice(0, this.photoColumns() * rows);
  });

  /** I1 while the grid reads: one row of tiles in the grid's own frame. */
  protected readonly photoPlaceholders = computed(() =>
    Array.from({ length: this.photoColumns() }, (_, index) => index),
  );

  /** A module heading's id, unique per page (the title's id leads it). */
  protected headingId(module: GlanceModule): string {
    return `${this.titleId()}-${module}`;
  }

  /** «Опитай пак» under one module. */
  protected retry(region: ClientCardRegion): void {
    this.store.retry(region);
  }

  /** «Опитай пак» under the head: every failed module again — or the whole card. */
  protected retryAll(): void {
    if (this.profileFailed()) {
      this.store.retry('profile');
      return;
    }
    for (const region of this.failedModules()) this.store.retry(region);
  }
}
