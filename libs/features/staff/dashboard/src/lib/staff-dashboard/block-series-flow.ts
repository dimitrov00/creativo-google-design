import { Injectable, computed, inject, signal } from '@angular/core';
import { TranslocoService } from '@jsverse/transloco';
import {
  BlockSeriesScope,
  type MinuteRange,
  type RecurrenceRule,
} from '@core/components';
import type { BlockSeries } from '@core/entities';
import type {
  BarberId,
  LocalDate,
  LocationId,
  TrackMinute,
} from '@core/primitives';
import { BlockSeriesSystem } from '@core/systems';
import type { UiAlertAction } from '@creativo/ui/patterns';
import { StaffDayStore } from '../staff-day.store';
import { blockKeyOf } from './grid-drop';
import { minuteRangeOf } from './staff-day-save';

/** The alert's way out that edits nothing. */
const SERIES_CANCEL = 'CANCEL';

/** An edit of a repeating block's day, waiting for how far it reaches. */
export type SeriesQuestion = {
  readonly series: BlockSeries;
  readonly localDate: LocalDate;
  /** The day's new range — `null` lifts it. */
  readonly range: MinuteRange | null;
  /** Told once the answer is in: `true` when the edit landed. */
  readonly settled: (saved: boolean) => void;
};

/**
 * THE REPEATING BLOCKS' DESK SIDE (owner, 2026-11-06: "a lunch break is a
 * recurring blocker"): a new repeating block is saved as a series, one per
 * chair, and an edit of a series day — the block sheet's «Запази» or
 * «Премахни», a drag on the grid — asks how far it reaches, as Apple
 * Calendar does: «Само този ден · Този и следващите». The page owns the
 * sheets and the grid; this owns the question and the writes it answers.
 */
@Injectable()
export class BlockSeriesFlow {
  private readonly store = inject(StaffDayStore);
  private readonly transloco = inject(TranslocoService);

  /** The question on screen, or `null`. */
  readonly question = signal<SeriesQuestion | null>(null);

  /** Why it asks — a move or a removal of a repeating time. */
  readonly message = computed(() => {
    const question = this.question();
    return question === null
      ? ''
      : this.transloco.translate(
          question.range === null
            ? 'staff.day.seriesLiftBody'
            : 'staff.day.seriesMoveBody',
        );
  });

  /** «Само този ден» (preferred, the smaller act) · «Този и следващите» · «Отказ». */
  readonly actions = computed<readonly UiAlertAction[]>(() => {
    this.question();
    return [
      {
        id: BlockSeriesScope.ThisDay,
        label: this.transloco.translate('staff.day.seriesThisDay'),
        preferred: true,
        testId: 'staff-series-this-day',
      },
      {
        id: BlockSeriesScope.Following,
        label: this.transloco.translate('staff.day.seriesFollowing'),
        testId: 'staff-series-following',
      },
      {
        id: SERIES_CANCEL,
        label: this.transloco.translate('staff.day.seriesCancel'),
        role: 'cancel',
        testId: 'staff-series-cancel',
      },
    ];
  });

  /** The series a chair's block on a day belongs to, or `null` — a block of its own. */
  memberOf(
    barberId: BarberId,
    localDate: LocalDate,
    range: MinuteRange | null,
  ): BlockSeries | null {
    return range === null
      ? null
      : BlockSeriesSystem.memberOf(
          this.store.repeatingBlocks(),
          barberId,
          localDate,
          range,
        );
  }

  /** The series a block (its grid key and minutes) belongs to, and its day — or `null`. */
  dayOf(block: {
    readonly blockId: string | null;
    readonly startMinute: TrackMinute;
    readonly endMinute: TrackMinute;
  }): { readonly series: BlockSeries; readonly day: LocalDate } | null {
    const key = block.blockId === null ? null : blockKeyOf(block.blockId);
    const series =
      key === null
        ? null
        : this.memberOf(
            key.barberId,
            key.localDate,
            minuteRangeOf(block.startMinute, block.endMinute),
          );
    return key === null || series === null
      ? null
      : { series, day: key.localDate };
  }

  /**
   * An edit of a block that is a series day asks how far it reaches —
   * `true` when it asked. A sheet that moved the block to ANOTHER day
   * (`toDay`, `null` when it cannot move days) is a plain edit of that
   * one day. `to` — the new range, or `null` to lift it.
   */
  askEdit(
    block: {
      readonly blockId: string | null;
      readonly startMinute: TrackMinute;
      readonly endMinute: TrackMinute;
    },
    toDay: LocalDate | null,
    to:
      | MinuteRange
      | { readonly startMinute: TrackMinute; readonly endMinute: TrackMinute }
      | null,
    settled: (saved: boolean) => void,
  ): boolean {
    const member = this.dayOf(block);
    if (member === null || (toDay !== null && toDay !== member.day)) {
      return false;
    }
    const range =
      to === null || !('startMinute' in to)
        ? to
        : minuteRangeOf(to.startMinute, to.endMinute);
    this.ask({ series: member.series, localDate: member.day, range, settled });
    return true;
  }

  /** Ask how far an edit of a series day reaches. */
  ask(question: SeriesQuestion): void {
    this.question.set(question);
  }

  /** The answer: the edit as far as it reaches, or nothing on «Отказ». */
  async pick(id: string): Promise<void> {
    const question = this.question();
    this.question.set(null);
    if (question === null) return;
    const scope =
      id === BlockSeriesScope.ThisDay || id === BlockSeriesScope.Following
        ? id
        : null;
    if (scope === null) {
      question.settled(false);
      return;
    }
    question.settled(
      await this.store.editSeries(
        question.series,
        question.localDate,
        scope,
        question.range,
      ),
    );
  }

  /**
   * A NEW repeating block, saved as a series on every chosen chair — each
   * filed at its home shop (`homeOf`). `true` once every chair landed.
   */
  async create(
    commit: {
      readonly barberIds: readonly BarberId[];
      readonly dayKey: LocalDate;
      readonly repeat: RecurrenceRule | null;
    },
    range: MinuteRange,
    homeOf: (barberId: BarberId) => LocationId | null,
  ): Promise<boolean> {
    const rule = commit.repeat;
    if (rule === null) return false;
    const startLocalDate = commit.dayKey;
    for (const barberId of commit.barberIds) {
      const locationId = homeOf(barberId);
      if (locationId === null) return false;
      const done = await this.store.createSeries({
        barberId,
        locationId,
        range,
        startLocalDate,
        rule,
      });
      if (!done) return false;
    }
    return true;
  }
}
