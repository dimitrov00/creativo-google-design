import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import {
  UiAvatar,
  UiBadge,
  UiButton,
  UiIcon,
  UiModalSheet,
} from '@creativo/ui/controls';
import { UiStack } from '@creativo/ui/layout';
import {
  UiForegroundStyleDirective,
  UiTextDirective,
  UiVisuallyHiddenDirective,
  UiWeightDirective,
} from '@creativo/ui/modifiers';
import {
  UI_SHEET_HEADLINE,
  UiCard,
  UiMedal,
  UiMetric,
  UiQuickAction,
  UiQuickActions,
  UiSheetHeader,
  type UiHeadlineMediaTone,
} from '@creativo/ui/patterns';
import { ScDemo } from '../../../shared/demo';
import { ScPage } from '../../../shared/page';

/**
 * The no-break space BEFORE a separator: where a quiet line wraps, its
 * first line ends on the «·», and the second never starts with one.
 */
const NBSP = '\u00a0';

/** One part of a quiet line: a FACT is primary ink at weight 500. */
interface LinePart {
  readonly text: string;
  readonly fact?: boolean;
}

/** One person's head, as the staff client card draws it. */
interface HeroSample {
  readonly id: string;
  readonly name: string;
  readonly line: readonly LinePart[];
  /** A second quiet line (the hero takes two at the most). */
  readonly second?: readonly LinePart[];
  /** Progress to the next tier, 0 … 1; `null` draws no ring. */
  readonly value: number | null;
  readonly tone: UiHeadlineMediaTone | null;
  /** The tier on the face's rim; `null` draws no plate. */
  readonly plate: string | null;
  /** The ring and the plate, in words, for a reader. */
  readonly words: string | null;
  readonly caption: string;
}

@Component({
  selector: 'cr-sheet-headline-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    NgTemplateOutlet,
    ScDemo,
    ScPage,
    UI_SHEET_HEADLINE,
    UiAvatar,
    UiBadge,
    UiButton,
    UiCard,
    UiForegroundStyleDirective,
    UiIcon,
    UiMedal,
    UiMetric,
    UiModalSheet,
    UiQuickAction,
    UiQuickActions,
    UiSheetHeader,
    UiStack,
    UiTextDirective,
    UiVisuallyHiddenDirective,
    UiWeightDirective,
  ],
  templateUrl: './sheet-headline.page.html',
  styleUrl: './sheet-headline.page.css',
})
export class SheetHeadlinePage {
  /** The glance's head: Георги, Gold, 60 % of the way to Platinum. */
  protected readonly georgi: HeroSample = {
    id: 'georgi',
    name: 'Георги Петров',
    line: [
      { text: 'Клиент от ' },
      { text: 'март 2025 г.', fact: true },
      { text: `${NBSP}· идва през ` },
      { text: '4 седмици', fact: true },
    ],
    value: 0.6,
    tone: null,
    plate: 'Злато',
    words: 'Злато, още 7 посещения до Платина',
    caption: 'uiHeadlineStyle=hero · uiMediaValue=0.6 · [uiHeadlinePlate]',
  };

  /** The head's other states, each on its own sheet. */
  protected readonly states: readonly HeroSample[] = [
    {
      id: 'paused',
      name: 'Мартин Илиев',
      line: [
        { text: 'Онлайн записването е спряно до ' },
        { text: '12.10', fact: true },
      ],
      value: 0.35,
      tone: 'warning',
      plate: 'Сребро',
      words: 'Сребро. Онлайн записването е спряно.',
      caption: 'uiMediaTone=warning wins over uiMediaValue: a FULL ring',
    },
    {
      id: 'top',
      name: 'Стефан Димов',
      line: [
        { text: 'Клиент от ' },
        { text: 'май 2023 г.', fact: true },
        { text: `${NBSP}· идва през ` },
        { text: '3 седмици', fact: true },
      ],
      value: 1,
      tone: null,
      plate: 'Платина',
      words: 'Платина, най-високото ниво',
      caption: 'uiMediaValue=1 · the top tier: the ring is full',
    },
    {
      id: 'new',
      name: 'Никола Стоянов',
      line: [{ text: 'Първо посещение' }],
      value: 0,
      tone: null,
      plate: 'Бронз',
      words: 'Бронз, още 5 посещения до Сребро',
      caption: 'uiMediaValue=0 · the track alone, no dot at 12 o’clock',
    },
    {
      id: 'guest',
      name: 'Петър',
      line: [{ text: 'Гост · без профил' }],
      value: null,
      tone: null,
      plate: null,
      words: null,
      caption: 'no ring, no plate: the box stays, nothing moves',
    },
  ];

  /** The longest name the seed holds, on the narrowest phone. */
  protected readonly long: HeroSample = {
    id: 'long',
    name: 'Александър Константинов-Христов',
    line: [
      { text: 'Клиент от ' },
      { text: 'септември 2024 г.', fact: true },
      { text: `${NBSP}· идва през ` },
      { text: '6 седмици', fact: true },
    ],
    value: 0.82,
    tone: null,
    plate: 'Сребро',
    words: 'Сребро, още 2 посещения до Злато',
    caption: '330 · three lines of 28, balanced · the line wraps in two',
  };

  /** Two quiet lines under the name: the most a head takes. */
  protected readonly twoLines: HeroSample = {
    id: 'two-lines',
    name: 'Иван Колев',
    line: [
      { text: 'Клиент от ' },
      { text: 'юни 2024 г.', fact: true },
      { text: `${NBSP}· идва през ` },
      { text: '5 седмици', fact: true },
    ],
    second: [
      { text: `Без неявявания${NBSP}· последно на ` },
      { text: '5.09', fact: true },
    ],
    value: 0.25,
    tone: null,
    plate: 'Злато',
    words: 'Злато, още 12 посещения до Платина',
    caption: 'callout 14, then subheadline 13 · 4 apart',
  };

  /** Whether the live sheet is presented. */
  protected readonly sheetOpen = signal(false);

  /** Rows under the live head: enough of a page for the head to leave. */
  protected readonly modules: readonly {
    readonly label: string;
    readonly headline: string;
    readonly line: string;
  }[] = [
    {
      label: 'Последно посещение',
      headline: 'Фейд · Оформяне на брада',
      line: '5.09 · Иван · Център',
    },
    {
      label: 'Следващ час',
      headline: 'Фейд',
      line: 'пт, 23.10 · 10:00 · Иван',
    },
    {
      label: 'Лоялност',
      headline: '371 точки',
      line: 'Стигат за безплатно оформяне на брада',
    },
    {
      label: 'Постижения',
      headline: '38 нива',
      line: 'С това посещение: Есен 2026, ниво II',
    },
    {
      label: 'Рекорди',
      headline: '9 посещения в ритъм',
      line: 'Най-дългата поредица',
    },
  ];
}
