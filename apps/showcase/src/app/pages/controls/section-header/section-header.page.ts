import { ChangeDetectionStrategy, Component } from '@angular/core';
import { UiButton, UiIcon, UiSkeleton } from '@creativo/ui/controls';
import { UiStack } from '@creativo/ui/layout';
import {
  UiCard,
  UiListGroup,
  UiListRow,
  UiSectionHeader,
} from '@creativo/ui/patterns';
import { UiFrameDirective, UiTextDirective } from '@creativo/ui/modifiers';
import { ScDemo } from '@showcase/shared/demo';
import { ScPage } from '@showcase/shared/page';

/** One pinned section of the demo history: a year, its count, its rows. */
interface YearSample {
  readonly label: string;
  readonly detail: string;
  readonly visits: readonly string[];
}

/**
 * One heading of the action demo: the module it heads, its action, and the
 * state the page holds still on it (`null` = at rest, live to the pointer).
 */
interface ActionSample {
  readonly id: string;
  readonly title: string;
  readonly label: string;
  /** The trailing chevron: a label alone keeps both of its paddings. */
  readonly glyph: boolean;
  readonly name: string;
  readonly held: 'hover' | 'focus' | null;
  readonly headline: string;
  readonly line: string;
  readonly caption: string;
}

@Component({
  selector: 'cr-section-header-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ScDemo,
    ScPage,
    UiButton,
    UiCard,
    UiFrameDirective,
    UiIcon,
    UiListGroup,
    UiListRow,
    UiSectionHeader,
    UiSkeleton,
    UiStack,
    UiTextDirective,
  ],
  templateUrl: './section-header.page.html',
  styleUrl: './section-header.page.css',
})
export class SectionHeaderPage {
  /**
   * The action at rest, with hover and keyboard focus held still, and as a
   * label alone.
   */
  protected readonly actions: readonly ActionSample[] = [
    {
      id: 'rest',
      title: 'Лоялност',
      label: 'Всички',
      glyph: true,
      name: 'Лоялност: всички подробности',
      held: null,
      headline: '371 точки',
      line: 'стигат за 2 от 3 награди',
      caption: 'at rest: hover it, press it, tab to it',
    },
    {
      id: 'hover',
      title: 'Постижения',
      label: '38',
      glyph: true,
      name: 'Всички постижения, 38 нива',
      held: 'hover',
      headline: 'Майстор на фейда',
      line: '23 от 25 до ниво III',
      caption: 'hover and press, held: the capsule ends on the card’s edge',
    },
    {
      id: 'focus',
      title: 'Рекорди',
      label: 'Всички',
      glyph: true,
      name: 'Всички рекорди',
      held: 'focus',
      headline: '9 посещения в ритъм',
      line: 'най-дългата поредица',
      caption: 'focus, held: the ring clears the card and the sheet’s edge',
    },
    {
      id: 'label',
      title: 'Любими',
      label: 'Всички',
      glyph: false,
      name: 'Всички любими',
      held: null,
      headline: 'Фейд',
      line: '17 от 24 посещения',
      caption: 'a label alone keeps both paddings, its words 8 inside',
    },
  ];

  /** Enough rows under each year for the pinned label to have to stick. */
  protected readonly years: readonly YearSample[] = [
    {
      label: 'Предстоящи',
      detail: '',
      visits: ['Фейд · пт, 10:00 · Иван'],
    },
    {
      label: '2026',
      detail: '9 посещения',
      visits: [
        'Фейд · 4.09 · Иван',
        'Фейд и брада · 12.08 · Иван',
        'Фейд · 15.07 · Никола',
        'Брада · 20.06 · Иван',
        'Фейд · 3.06 · Иван',
      ],
    },
    {
      label: '2025',
      detail: '14 посещения',
      visits: [
        'Фейд · 18.12 · Иван',
        'Класическа · 20.11 · Стефан',
        'Фейд · 23.10 · Иван',
        'Фейд · 25.09 · Иван',
      ],
    },
  ];
}
