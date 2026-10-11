import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import type { UiStreakPeriod } from '@creativo/ui/controls';
import { UiButton, UiCard, UiStreakTrack } from '@creativo/ui/controls';
import { UiGrid, UiStack } from '@creativo/ui/layout';
import { UiTextDirective } from '@creativo/ui/modifiers';
import { ScDemo } from '@showcase/shared/demo';
import { ScPage } from '@showcase/shared/page';

const MONTHS = ['май', 'юни', 'юли', 'авг', 'сеп'] as const;

/** Five kept months and the open one, due by a date — never a countdown. */
const KEPT_RUN: readonly UiStreakPeriod[] = [
  ...MONTHS.map((month) => ({
    id: month,
    mark: 'kept' as const,
    caption: month,
    description: `${month} · дойде`,
  })),
  {
    id: 'окт',
    mark: 'current',
    caption: 'до 26.10',
    description: 'октомври · следващото посещение до 26 октомври',
  },
];

@Component({
  selector: 'cr-streak-track-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ScDemo,
    ScPage,
    UiButton,
    UiCard,
    UiGrid,
    UiStack,
    UiStreakTrack,
    UiTextDirective,
  ],
  templateUrl: './streak-track.page.html',
  styleUrl: './streak-track.page.css',
})
export class StreakTrackPage {
  protected readonly keptRun = KEPT_RUN;

  /** Every kind of period on one track. */
  protected readonly everyKind: readonly UiStreakPeriod[] = [
    { id: 'apr', mark: 'kept', caption: 'апр', description: 'април · дойде' },
    {
      id: 'may',
      mark: 'protected',
      caption: 'май',
      description: 'май · защита: салонът беше затворен',
    },
    { id: 'jun', mark: 'kept', caption: 'юни', description: 'юни · дойде' },
    {
      id: 'jul',
      mark: 'missed',
      caption: 'юли',
      description: 'юли · пропуснат',
    },
    {
      id: 'aug',
      mark: 'repaired',
      caption: 'авг',
      description: 'август · поправен',
    },
    {
      id: 'sep',
      mark: 'kept',
      caption: 'сеп',
      description: 'септември · дойде',
    },
    {
      id: 'oct',
      mark: 'current',
      caption: 'до 12.10',
      description: 'октомври · следващото посещение до 12 октомври',
    },
  ];

  /** The glance tile's button form was tapped. */
  protected readonly tileOpened = signal(false);

  /** The live demo: the open period is kept, and a new one opens. */
  protected readonly liveRun = signal<readonly UiStreakPeriod[]>(KEPT_RUN);
  protected readonly liveCount = signal(24);

  protected keepPeriod(): void {
    const periods = this.liveRun();
    const open = periods[periods.length - 1];
    if (!open) return;
    const next = `p${periods.length + this.liveCount()}`;
    this.liveRun.set([
      ...periods.slice(1, -1),
      {
        ...open,
        mark: 'kept',
        caption: open.id,
        description: `${open.id} · дойде`,
      },
      {
        id: next,
        mark: 'current',
        caption: 'до 23.11',
        description: 'следващото посещение до 23 ноември',
      },
    ]);
    this.liveCount.update((count) => count + 1);
  }

  protected reset(): void {
    this.liveRun.set(KEPT_RUN);
    this.liveCount.set(24);
  }
}
