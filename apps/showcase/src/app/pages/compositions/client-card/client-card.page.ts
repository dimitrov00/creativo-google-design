import { NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import {
  UiAvatar,
  UiBadge,
  UiButton,
  UiProgressRing,
} from '@creativo/ui/controls';
import { UiIcon, UiLogo, type UiIconName } from '@creativo/ui/icons';
import { UiGrid, UiStack } from '@creativo/ui/layout';
import {
  UiForegroundStyleDirective,
  UiFrameDirective,
  UiInteractiveDirective,
  UiTextDirective,
  UiVisuallyHiddenDirective,
  UiWeightDirective,
} from '@creativo/ui/modifiers';
import {
  UI_SHEET_HEADLINE,
  UiCard,
  UiCouponCard,
  UiGauge,
  UiListGroup,
  UiListRow,
  UiMedal,
  UiMetric,
  UiOccasionBand,
  UiPassCard,
  UiQuickAction,
  UiQuickActions,
  UiSectionHeader,
  UiSheetHeader,
  type UiMedalState,
} from '@creativo/ui/patterns';
import { ScPage } from '../../../shared/page';

/**
 * The no-break space: BEFORE a separator, so a quiet line that wraps ends
 * its first line on the «·»; and between a year and its «г.», so the two
 * are never parted.
 */
const NBSP = '\u00a0';

/** One run of a quiet line: a FACT is primary ink at weight 500. */
interface LinePart {
  readonly text: string;
  readonly fact?: boolean;
}

/** A client, as the head of the staff card draws them. */
interface Person {
  readonly id: string;
  readonly name: string;
  /** The face; `null` draws the initials. */
  readonly src: string | null;
  readonly line: readonly LinePart[];
  /** Progress to the next tier, 0 … 1; `null` draws no ring. */
  readonly ring: number | null;
  /** The tier on the face's rim. */
  readonly tier: string;
  /** The ring and the plate, in words, for a reader. */
  readonly words: string;
}

/** One verb of a run of discs. */
interface Verb {
  readonly id: string;
  readonly icon: UiIconName;
  readonly label: string;
  /** The accessible name: it begins with the word under the disc. */
  readonly name: string;
  /** THE promoted verb of its run. */
  readonly promoted?: boolean;
}

/** One head over its discs: the two fills of owner question Q2. */
interface HeadSample {
  readonly id: string;
  readonly caption: string;
  readonly note: string;
  /** Every disc in the accent wash, the promoted one solid. */
  readonly tinted: boolean;
}

/** One record of the 2 × 2, as «Постижения» opens with it. */
interface RecordSample {
  readonly id: string;
  readonly icon: UiIconName;
  /** The subject's picture in place of the emblem (a favourite service). */
  readonly src: string | null;
  readonly label: string;
  readonly figure: string;
  readonly detail: string;
  readonly isNew: boolean;
  readonly name: string;
}

/** One row of the «Рекорди» page. */
interface RecordRow {
  readonly id: string;
  readonly icon: UiIconName;
  readonly label: string;
  readonly detail: string | null;
  readonly figure: string;
}

/** One family of a category's grid, in any state. */
interface MedalTile {
  readonly id: string;
  readonly state: UiMedalState;
  readonly icon: UiIconName;
  readonly level: string | null;
  readonly title: string;
  readonly caption: string;
  /** 0 … 1 from the last level won to the next; `null` draws the track alone. */
  readonly value: number | null;
  readonly valueText: string | null;
  readonly isNew: boolean;
  readonly name: string;
}

/** The barber's face, top-trailing on a visit card. */
const BARBER_FACE = 'https://i.pravatar.cc/128?img=53';

/** A client who has uploaded a portrait. */
const CLIENT_FACE = 'https://i.pravatar.cc/256?img=13';

/** The cover of «Фейд»: a favourite's emblem is the service itself. */
const FADE_COVER =
  'https://images.unsplash.com/photo-1599351431202-1e0f0137899a?w=400&h=600&fit=crop';

const GEORGI: Person = {
  id: 'georgi',
  name: 'Георги Петров',
  src: null,
  line: [
    { text: 'Клиент от ' },
    { text: 'март 2025 г.', fact: true },
    { text: `${NBSP}· идва през ` },
    { text: '4 седмици', fact: true },
  ],
  ring: 0.6,
  tier: 'Злато',
  words: 'Злато, още 7 посещения до Платина',
};

const MARTIN: Person = {
  id: 'martin',
  name: 'Мартин Илиев',
  src: CLIENT_FACE,
  line: [
    { text: 'Клиент от ' },
    { text: 'май 2025 г.', fact: true },
    { text: `${NBSP}· идва през ` },
    { text: '5 седмици', fact: true },
  ],
  ring: 0.35,
  tier: 'Сребро',
  words: 'Сребро, още 6 посещения до Злато',
};

const STEFAN: Person = {
  id: 'stefan',
  name: 'Стефан Димов',
  src: null,
  line: [
    { text: 'Клиент от ' },
    { text: 'май 2023 г.', fact: true },
    { text: `${NBSP}· идва през ` },
    { text: '3 седмици', fact: true },
  ],
  ring: 1,
  tier: 'Платина',
  words: 'Платина, най-високият статус',
};

const CALL: Verb = {
  id: 'call',
  icon: 'contact.phone',
  label: 'Обади се',
  name: 'Обади се на клиента',
};
const SMS: Verb = {
  id: 'sms',
  icon: 'contact.sms',
  label: 'SMS',
  name: 'SMS до клиента',
};
const VIBER: Verb = {
  id: 'viber',
  icon: 'contact.viber',
  label: 'Viber',
  name: 'Viber до клиента',
};
const REPEAT: Verb = {
  id: 'same',
  icon: 'visit.repeat',
  label: 'Повтори',
  name: 'Повтори последното посещение: фейд, оформяне на брада',
  promoted: true,
};

/**
 * THE CLIENT CARD, COMPOSED (revision 3, review 1). The pieces of the
 * design system put together as the staff card's pages put them together,
 * on stand-ins for the visit sheet at a phone's width, so the language is
 * judged on real pixels before a page is built: the person first, colour
 * as a shape and words as ink, white lifted surfaces with room round
 * them. `@creativo/ui` only; the data is a sample, the pieces are real.
 */
@Component({
  selector: 'cr-client-card-composition-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    NgTemplateOutlet,
    ScPage,
    UI_SHEET_HEADLINE,
    UiAvatar,
    UiBadge,
    UiButton,
    UiCard,
    UiCouponCard,
    UiForegroundStyleDirective,
    UiFrameDirective,
    UiGauge,
    UiGrid,
    UiIcon,
    UiInteractiveDirective,
    UiListGroup,
    UiListRow,
    UiLogo,
    UiMedal,
    UiMetric,
    UiOccasionBand,
    UiPassCard,
    UiProgressRing,
    UiQuickAction,
    UiQuickActions,
    UiSectionHeader,
    UiSheetHeader,
    UiStack,
    UiTextDirective,
    UiVisuallyHiddenDirective,
    UiWeightDirective,
  ],
  templateUrl: './client-card.page.html',
  styleUrl: './client-card.page.css',
})
export class ClientCardCompositionPage {
  protected readonly georgi = GEORGI;
  protected readonly martin = MARTIN;
  protected readonly stefan = STEFAN;

  protected readonly barberFace = BARBER_FACE;

  /** Owner question Q2: one head, the two fills its discs can wear. */
  protected readonly heads: readonly HeadSample[] = [
    {
      id: 'neutral',
      caption: 'Неутрални (R2-B)',
      note: 'The discs are quiet; the one promoted verb wears the accent wash.',
      tinted: false,
    },
    {
      id: 'tinted',
      caption: 'Оцветени (както преди)',
      note: 'Every disc in the accent wash; the promoted verb a solid mark.',
      tinted: true,
    },
  ];

  /** How to reach a person, and the one verb the card promotes. */
  protected readonly contactVerbs: readonly Verb[] = [CALL, SMS, VIBER, REPEAT];

  /** A first-time client has nothing to repeat: the verb is absent. */
  protected readonly reachVerbs: readonly Verb[] = [CALL, SMS, VIBER];

  /** The wallet's run: what can be done with what is held. */
  protected readonly walletVerbs: readonly Verb[] = [
    {
      id: 'use',
      icon: 'promo.coupon',
      label: 'Използвай',
      name: 'Използвай наградата: безплатно подстригване',
      promoted: true,
    },
    {
      id: 'code',
      icon: 'loyalty.enterCode',
      label: 'Код',
      name: 'Код за отстъпка',
    },
    {
      id: 'catalog',
      icon: 'loyalty.reward',
      label: 'Награди',
      name: 'Награди за точки',
    },
    {
      id: 'history',
      icon: 'loyalty.ledger',
      label: 'История',
      name: 'История на точките',
    },
  ];

  /** «Рекорди», first on «Постижения»: the four records of the account. */
  protected readonly records: readonly RecordSample[] = [
    {
      id: 'longestRhythm',
      icon: 'loyalty.record.longestRhythm',
      src: null,
      label: 'Най-дълъг ритъм',
      figure: '9',
      detail: `септември 2026${NBSP}г.`,
      isNew: true,
      name: 'Най-дълъг ритъм: 9 посещения, септември 2026 г., нов рекорд',
    },
    {
      id: 'mostVisitsInYear',
      icon: 'loyalty.record.mostVisitsInYear',
      src: null,
      label: 'Най-много за година',
      figure: '13',
      detail: `2026${NBSP}г.`,
      isNew: false,
      name: 'Най-много посещения за година: 13, 2026 г.',
    },
    {
      id: 'favouriteService',
      icon: 'loyalty.record.favouriteService',
      src: FADE_COVER,
      label: 'Любима услуга',
      figure: 'Фейд',
      detail: '23 пъти',
      isNew: false,
      name: 'Любима услуга: фейд, 23 пъти',
    },
    {
      id: 'firstVisit',
      icon: 'loyalty.record.firstVisit',
      src: null,
      label: 'Първо посещение',
      figure: '1 март',
      detail: `2025${NBSP}г.`,
      isNew: false,
      name: 'Първо посещение: 1 март 2025 г.',
    },
  ];

  /** The «Рекорди» page under its featured card: facts the card reads. */
  protected readonly recordRows: readonly RecordRow[] = [
    {
      id: 'totalVisits',
      icon: 'loyalty.record.totalVisits',
      label: 'Общо посещения',
      detail: null,
      figure: '23',
    },
    {
      id: 'last12Months',
      icon: 'loyalty.record.last12Months',
      label: 'Последните 12 месеца',
      detail: null,
      figure: '15',
    },
    {
      id: 'mostVisitsInYear',
      icon: 'loyalty.record.mostVisitsInYear',
      label: 'Най-много за година',
      detail: `2026${NBSP}г.`,
      figure: '13',
    },
  ];

  /**
   * A category's grid, three by two, already in shelf order: what is won
   * (the highest level leading), what is under way (the closest leading),
   * what is not started.
   */
  protected readonly medals: readonly MedalTile[] = [
    {
      id: 'visits',
      state: 'earned',
      icon: 'loyalty.badge.visits',
      level: 'III',
      title: 'Посещения',
      caption: '23/25 до IV',
      value: 13 / 15,
      valueText: '23 от 25 до ниво IV',
      isNew: false,
      name: 'Посещения, ниво III, 23 от 25 до ниво IV',
    },
    {
      id: 'online',
      state: 'earned',
      icon: 'loyalty.badge.selfService',
      level: 'II',
      title: 'Онлайн записване',
      caption: '11/25 до III',
      value: 1 / 15,
      valueText: '11 от 25 до ниво III',
      isNew: true,
      name: 'Онлайн записване, ниво II спечелено на 5 септември, 11 от 25 до ниво III, ново',
    },
    {
      id: 'tenure',
      state: 'complete',
      icon: 'loyalty.badge.anniversary',
      level: null,
      title: 'Година с нас',
      caption: '1.03.2026',
      value: null,
      valueText: null,
      isNew: false,
      name: 'Година с нас, спечелено на 1 март 2026 г.',
    },
    {
      id: 'weekend',
      state: 'inProgress',
      icon: 'loyalty.badge.weekend',
      level: null,
      title: 'Съботен',
      caption: '2/3 до I',
      value: 2 / 3,
      valueText: '2 от 3 до ниво I',
      isNew: false,
      name: 'Съботен, 2 от 3 до ниво I',
    },
    {
      id: 'early',
      state: 'inProgress',
      icon: 'loyalty.badge.earlyBird',
      level: null,
      title: 'Ранобудник',
      caption: '1/3 до I',
      value: 1 / 3,
      valueText: '1 от 3 до ниво I',
      isNew: false,
      name: 'Ранобудник, 1 от 3 до ниво I',
    },
    {
      id: 'referral',
      state: 'notStarted',
      icon: 'loyalty.badge.referral',
      level: null,
      title: 'Препоръка',
      caption: '0/1 до I',
      value: null,
      valueText: null,
      isNew: false,
      name: 'Препоръка, не е започнато, 0 от 1 до ниво I',
    },
  ];

  /**
   * A 330 pt phone. There «Постижения» draws its grids on tighter metrics
   * (the card pads less, its columns stand a tight step apart), and so
   * does this page, so a tile is as wide here as it is in the sheet.
   */
  protected readonly narrow = signal(false);

  /** What the last press did: a sample page hands nothing off. */
  protected readonly last = signal<string | null>(null);

  /** The press, in words, for the page's status line. */
  protected readonly lastWords = computed(() => {
    const last = this.last();
    return last === null
      ? 'Every control is live; nothing leaves the page.'
      : `Last press: ${last}`;
  });

  constructor() {
    if (typeof globalThis.matchMedia !== 'function') return;
    const query = globalThis.matchMedia('(max-width: 23.5rem)');
    const sync = (): void => this.narrow.set(query.matches);
    sync();
    query.addEventListener('change', sync);
    inject(DestroyRef).onDestroy(() =>
      query.removeEventListener('change', sync),
    );
  }

  protected act(what: string): void {
    this.last.set(what);
  }
}
