import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
  signal,
} from '@angular/core';
import type {
  UiIconName,
  UiMedalControlSize,
  UiMedalState,
} from '@creativo/ui/controls';
import {
  UiBadge,
  UiButton,
  UiCard,
  UiGauge,
  UiMedal,
} from '@creativo/ui/controls';
import { UiFlow, UiGrid, UiStack } from '@creativo/ui/layout';
import { UiFrameDirective, UiTextDirective } from '@creativo/ui/modifiers';
import { ScDemo } from '@showcase/shared/demo';
import { ScPage } from '@showcase/shared/page';

/** One state of one family, as a presenter hands it to the medal. */
interface MedalSample {
  readonly state: UiMedalState;
  readonly level: string | null;
  readonly caption: string;
  /** 0 … 1 from the last threshold won to the next; `null` draws the track alone. */
  readonly value: number | null;
  readonly valueText: string | null;
  readonly label: string;
}

/** One tile of a grid: a family in any state. */
interface MedalTile extends MedalSample {
  readonly key: string;
  readonly icon: UiIconName;
  readonly monogram: string | null;
  readonly src: string | null;
  readonly title: string;
  readonly isNew: boolean;
}

/** One rung of a family's ladder: a medal and its words. */
interface LadderRow {
  readonly level: string;
  readonly state: UiMedalState;
  /** Passed and next are said in the primary ink; what is further is quiet. */
  readonly quiet: boolean;
  readonly title: string;
  readonly reward: string;
  readonly earned: string | null;
  readonly label: string;
}

/**
 * A shop's cover, in COLOUR: full colour means earned, so the art a medal
 * draws with must have some to lose.
 */
const ART =
  'https://images.unsplash.com/photo-1585747860715-2ba37e788b70?w=320&h=320&fit=crop';

/**
 * A service's cover, a PORTRAIT picture (400 × 600), the ratio the seed's
 * covers have (1100 × 1400): the disc must crop it to a circle in every
 * state, never draw it as an egg below the ring.
 */
const PORTRAIT_ART =
  'https://images.unsplash.com/photo-1599351431202-1e0f0137899a?w=400&h=600&fit=crop';

/**
 * «Фейд»: I = 3, II = 10, III = 25, IV = 50, V = 100. At 23 visits level
 * II is won and the ring draws (23 − 10) / (25 − 10), 87 %.
 */
const FADE_EARNED: MedalSample = {
  state: 'earned',
  level: 'II',
  caption: '23/25 до III',
  value: 13 / 15,
  valueText: '23 от 25 до ниво III',
  label: 'Фейд, ниво II спечелено на 24 септември, 23 от 25 до ниво III',
};

const FADE: readonly MedalSample[] = [
  {
    state: 'notStarted',
    level: null,
    caption: '0/3 до I',
    value: null,
    valueText: null,
    label: 'Фейд, не е започнато, 0 от 3 до ниво I',
  },
  {
    state: 'inProgress',
    level: null,
    caption: '2/3 до I',
    value: 2 / 3,
    valueText: '2 от 3 до ниво I',
    label: 'Фейд, 2 от 3 до ниво I',
  },
  FADE_EARNED,
  {
    state: 'complete',
    level: 'V',
    caption: 'Всички нива',
    value: null,
    valueText: null,
    label: 'Фейд, всички нива спечелени, последното на 3 юни',
  },
];

/**
 * A category as the achievements page draws it, already in shelf order:
 * what is won first (the highest level leading), then what is under way
 * (the closest leading), then what is not started.
 *
 * The two long titles carry a SOFT HYPHEN (U+00AD): where the engine has
 * no hyphenation dictionary for Bulgarian (Chromium on a desktop), a word
 * wider than its tile breaks there, with a hyphen, instead of mid-word.
 */
const MASTERY: readonly MedalTile[] = [
  {
    key: 'visits',
    state: 'complete',
    icon: 'loyalty.badge.visits',
    monogram: null,
    src: null,
    level: 'V',
    title: 'Посещения',
    caption: 'Всички нива',
    value: null,
    valueText: null,
    label: 'Посещения, всички нива спечелени',
    isNew: false,
  },
  {
    key: 'fade',
    state: 'earned',
    icon: 'loyalty.badge.service',
    monogram: null,
    src: null,
    level: 'II',
    title: 'Фейд',
    caption: '23/25 до III',
    value: 13 / 15,
    valueText: '23 от 25 до ниво III',
    label:
      'Фейд, ниво II спечелено на 24 септември, 23 от 25 до ниво III, ново',
    isNew: true,
  },
  {
    key: 'centre',
    state: 'earned',
    icon: 'loyalty.badge.shop',
    monogram: null,
    src: ART,
    level: 'I',
    title: 'Център',
    caption: '4/10 до II',
    value: 1 / 7,
    valueText: '4 от 10 до ниво II',
    label: 'Център, ниво I спечелено на 4 септември, 4 от 10 до ниво II',
    isNew: false,
  },
  {
    key: 'online',
    state: 'earned',
    icon: 'loyalty.badge.selfService',
    monogram: null,
    src: null,
    level: 'I',
    title: 'Онлайн записване',
    caption: '9/10 до II',
    value: 6 / 7,
    valueText: '9 от 10 до ниво II',
    label: 'Онлайн записване, ниво I, 9 от 10 до ниво II',
    isNew: false,
  },
  {
    key: 'tenure',
    state: 'complete',
    icon: 'loyalty.badge.anniversary',
    monogram: null,
    src: null,
    level: null,
    title: 'Години с нас',
    caption: '7.05.2025',
    value: null,
    valueText: null,
    label: 'Години с нас, спечелено на 7 май 2025 г.',
    isNew: false,
  },
  {
    key: 'weekend',
    state: 'inProgress',
    icon: 'loyalty.badge.weekend',
    monogram: null,
    src: null,
    level: null,
    title: 'Съботен',
    caption: '2/3 до I',
    value: 2 / 3,
    valueText: '2 от 3 до ниво I',
    label: 'Съботен, 2 от 3 до ниво I',
    isNew: false,
  },
  {
    key: 'early',
    state: 'inProgress',
    icon: 'loyalty.badge.earlyBird',
    monogram: null,
    src: null,
    level: null,
    title: 'Ранобудник',
    caption: '1/3 до I',
    value: 1 / 3,
    valueText: '1 от 3 до ниво I',
    label: 'Ранобудник, 1 от 3 до ниво I',
    isNew: false,
  },
  {
    key: 'explorer',
    state: 'notStarted',
    icon: 'loyalty.badge.explorer',
    monogram: null,
    src: null,
    level: null,
    title: 'Изследо\u00ADвател',
    caption: '0/3 до I',
    value: null,
    valueText: null,
    label: 'Изследовател, не е започнато, 0 от 3 до ниво I',
    isNew: false,
  },
  {
    key: 'scissors',
    state: 'notStarted',
    icon: 'loyalty.badge.service',
    monogram: 'П',
    src: null,
    level: null,
    title: 'Подстриж\u00ADка с ножица',
    caption: '0/1 до I',
    value: null,
    valueText: null,
    label: 'Подстрижка с ножица, не е започнато, 0 от 1 до ниво I',
    isNew: false,
  },
];

/** «Фейд» at 23 visits: two levels passed, the third next, two further. */
const LADDER: readonly LadderRow[] = [
  {
    level: 'I',
    state: 'complete',
    quiet: false,
    title: 'Ниво I · 3 посещения',
    reward: 'Значка в профила',
    earned: '16.04.2025',
    label:
      'Ниво I, 3 посещения, значка в профила, спечелено на 16 април 2025 г.',
  },
  {
    level: 'II',
    state: 'complete',
    quiet: false,
    title: 'Ниво II · 10 посещения',
    reward: '50 точки',
    earned: '24.09.2025',
    label: 'Ниво II, 10 посещения, 50 точки, спечелено на 24 септември 2025 г.',
  },
  {
    level: 'III',
    state: 'notStarted',
    quiet: false,
    title: 'Ниво III · 25 посещения',
    reward: '50 точки',
    earned: null,
    label: 'Ниво III, 25 посещения, 50 точки, следващото',
  },
  {
    level: 'IV',
    state: 'notStarted',
    quiet: true,
    title: 'Ниво IV · 50 посещения',
    reward: 'Безплатно оформяне на брада',
    earned: null,
    label: 'Ниво IV, 50 посещения, безплатно оформяне на брада',
  },
  {
    level: 'V',
    state: 'notStarted',
    quiet: true,
    title: 'Ниво V · 100 посещения',
    reward: 'Безплатен фейд',
    earned: null,
    label: 'Ниво V, 100 посещения, безплатен фейд',
  },
];

@Component({
  selector: 'cr-medal-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ScDemo,
    ScPage,
    UiBadge,
    UiButton,
    UiCard,
    UiFlow,
    UiFrameDirective,
    UiGauge,
    UiGrid,
    UiMedal,
    UiStack,
    UiTextDirective,
  ],
  templateUrl: './medal.page.html',
  styleUrl: './medal.page.css',
})
export class MedalPage {
  /** The grid's two sizes: a row of four on a wide page, two and two on a phone. */
  protected readonly sizes: readonly UiMedalControlSize[] = [
    'regular',
    'large',
  ];

  /** Every size, for the pieces that stand in one row. */
  protected readonly allSizes: readonly UiMedalControlSize[] = [
    'regular',
    'large',
    'extraLarge',
  ];

  /** The four states of one family. */
  protected readonly states = FADE;

  /** The earned one: what stands beside the ring that stands alone. */
  protected readonly earned = FADE_EARNED;

  protected readonly art = ART;
  protected readonly portraitArt = PORTRAIT_ART;
  protected readonly emblem: UiIconName = 'loyalty.badge.service';

  /** A category's grid: every state in three columns. */
  protected readonly mastery = MASTERY;

  /** A family's ladder: a medal a level. */
  protected readonly ladder = LADDER;

  /** Four states in one row from a tablet's width; two and two under it. */
  protected readonly stateColumns = signal(2);

  /**
   * A 330 pt phone. There «Постижения» draws its grids on tighter metrics
   * (the card pads 12, its columns stand a tight step apart) and so does
   * this page, so a tile is as wide here as it is in the sheet: 86 of 87.
   */
  protected readonly narrow = signal(false);

  /** The last family opened from the grid. */
  protected readonly tileOpened = signal<string | null>(null);

  /** The last detail opened from the row of three. */
  protected readonly opened = signal<string | null>(null);

  /** M16: a live earn fills the disc and glides the arc. */
  protected readonly earnedLive = signal(false);

  constructor() {
    if (typeof globalThis.matchMedia !== 'function') return;
    const wide = globalThis.matchMedia('(min-width: 40rem)');
    const narrow = globalThis.matchMedia('(max-width: 23.5rem)');
    const sync = (): void => {
      this.stateColumns.set(wide.matches ? 4 : 2);
      this.narrow.set(narrow.matches);
    };
    sync();
    wide.addEventListener('change', sync);
    narrow.addEventListener('change', sync);
    inject(DestroyRef).onDestroy(() => {
      wide.removeEventListener('change', sync);
      narrow.removeEventListener('change', sync);
    });
  }
}
