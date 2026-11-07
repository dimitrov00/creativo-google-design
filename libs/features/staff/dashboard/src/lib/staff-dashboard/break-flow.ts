import { Injectable, computed, inject, signal } from '@angular/core';
import { TranslocoService } from '@jsverse/transloco';
import type { MinuteRange } from '@core/components';
import type { BlockEditorCommit } from '../block-editor/staff-block-editor';
import { breakKeyOf } from './grid-drop';
import { minuteRangeOf } from './staff-day-save';
import {
  type BarberId,
  LocalDate,
  type LocationId,
  type TrackMinute,
} from '@core/primitives';
import { RosterBreakSystem } from '@core/systems';
import type { UiAlertAction } from '@creativo/ui/patterns';
import { StaffDayStore } from '../staff-day.store';

/** The two reaches of a break edit, and the way out that edits nothing. */
export const BreakScope = {
  ThisDay: 'THIS_DAY',
  Following: 'FOLLOWING',
  Cancel: 'CANCEL',
} as const;
export type BreakScope = (typeof BreakScope)[keyof typeof BreakScope];

/** A roster break's edit, waiting for how far it reaches. */
export type BreakEdit = {
  readonly barberId: BarberId;
  /** The chair's home shop — it files the day, its clock says «today». */
  readonly locationId: LocationId;
  readonly localDate: LocalDate;
  /** The break as drawn — clipped to worked time. */
  readonly drawn: MinuteRange;
  /** Its new range, or `null` to take it off. */
  readonly to: MinuteRange | null;
};

/** What an answered edit did: saved or not, and the act that takes it back. */
export type BreakAnswer = {
  readonly saved: boolean;
  readonly undo: (() => Promise<boolean>) | null;
};

const NOTHING: BreakAnswer = { saved: false, undo: null };

/**
 * A CHAIR'S BREAK, EDITED ON THE GRID (owner, 2026-11-06: "barbers decide
 * to work harder for winter … no lunch breaks for some specific days …
 * removed day by day"): a tap takes the break off, a drag moves it, and
 * either asks how far it reaches — Apple Calendar's question, the smaller
 * act preferred: «Само този ден» writes that day's own breaks (one
 * exception document, `setDayBreaks`), «Този и следващите» changes the
 * weekly roster from that day on (one roster write, `amendBreaks`). A day
 * that already says its own breaks asks nothing — the edit is that day's.
 * Either way the time is bookable at once when a break goes, on the desk
 * and on `/book`. The page owns the grid; this owns the question.
 */
@Injectable()
export class BreakFlow {
  private readonly store = inject(StaffDayStore);
  private readonly transloco = inject(TranslocoService);

  /** The edit on screen, or `null`. */
  readonly question = signal<BreakEdit | null>(null);
  private answered: ((answer: BreakAnswer) => void) | null = null;

  /** Why it asks — a move or a removal of the weekly break. */
  readonly message = computed(() => {
    const question = this.question();
    return question === null
      ? ''
      : this.transloco.translate(
          question.to === null
            ? 'staff.day.breakLiftBody'
            : 'staff.day.breakMoveBody',
          { weekday: this.weekdayOf(question.localDate) },
        );
  });

  /** «Само този ден» (preferred, the smaller act) · «Този и следващите» · «Отказ». */
  readonly actions = computed<readonly UiAlertAction[]>(() => {
    this.question();
    return [
      {
        id: BreakScope.ThisDay,
        label: this.transloco.translate('staff.day.breakThisDay'),
        preferred: true,
        testId: 'staff-break-this-day',
      },
      {
        id: BreakScope.Following,
        label: this.transloco.translate('staff.day.breakFollowing'),
        testId: 'staff-break-following',
      },
      {
        id: BreakScope.Cancel,
        label: this.transloco.translate('staff.day.breakCancel'),
        role: 'cancel',
        testId: 'staff-break-cancel',
      },
    ];
  });

  /**
   * Edit a chair's break: on a day that says its own breaks it lands at
   * once, on a roster day it asks first. The answer says whether it saved
   * and how to take it back.
   */
  edit(edit: BreakEdit): Promise<BreakAnswer> {
    if (this.laneOf(edit)?.breaksOwn) return this.thisDay(edit);
    this.answered?.(NOTHING);
    this.question.set(edit);
    return new Promise((resolve) => (this.answered = resolve));
  }

  /**
   * The break an id names (`break:<chair>:<day>:<start>` — the grid's and
   * the agenda's alike), as its chair's lane draws it on that day, as an
   * edit that takes it off — filed at the chair's home (`homeOf`); `null`
   * when it is not drawn.
   */
  editOf(
    id: string,
    homeOf: (barberId: BarberId) => LocationId | null,
  ): BreakEdit | null {
    const key = breakKeyOf(id);
    if (key === null) return null;
    const start = Number(id.split(':').at(-1));
    const drawn = this.laneOf(key)?.breaks.find(
      (entry) => entry.startMinutes === start,
    );
    const locationId = homeOf(key.barberId);
    return drawn === undefined || locationId === null
      ? null
      : { ...key, locationId, drawn, to: null };
  }

  /** A break dragged to `to` — the edit that moves it, or `null` when it did not move. */
  moveOf(
    to: { readonly id: string } & {
      readonly startMinute: TrackMinute;
      readonly endMinute: TrackMinute;
    },
    homeOf: (barberId: BarberId) => LocationId | null,
  ): BreakEdit | null {
    const edit = this.editOf(to.id, homeOf);
    const range = minuteRangeOf(to.startMinute, to.endMinute);
    return edit === null ||
      range === null ||
      (range.startMinutes === edit.drawn.startMinutes &&
        range.endMinutes === edit.drawn.endMinutes)
      ? null
      : { ...edit, to: range };
  }

  /**
   * «Без край» on the block sheet: a weekly break of every chosen chair's
   * roster from the frame's day on — ONE roster write per chair
   * (`amendRosterBreaks`), never a document per day (owner, 2026-11-06).
   * `true` once every chair landed.
   */
  async stand(
    commit: BlockEditorCommit,
    homeOf: (barberId: BarberId) => LocationId | null,
  ): Promise<boolean> {
    const after = minuteRangeOf(commit.startMinute, commit.endMinute);
    if (after === null || commit.standing === null) return false;
    for (const barberId of commit.barberIds) {
      const locationId = homeOf(barberId);
      if (locationId === null) return false;
      const done = await this.store.amendBreaks({
        barberId,
        locationId,
        fromLocalDate: commit.dayKey,
        weekdays: commit.standing,
        before: null,
        after,
      });
      if (!done) return false;
    }
    return true;
  }

  /** The answer to the question on screen. */
  async pick(id: string): Promise<void> {
    const question = this.question();
    const answered = this.answered;
    this.question.set(null);
    this.answered = null;
    if (question === null || answered === null) return;
    answered(
      id === BreakScope.ThisDay
        ? await this.thisDay(question)
        : id === BreakScope.Following
          ? await this.following(question)
          : NOTHING,
    );
  }

  /** «Само този ден»: the day's own breaks, the edited one replaced; undone by handing back what the day said. */
  private async thisDay(edit: BreakEdit): Promise<BreakAnswer> {
    const lane = this.laneOf(edit);
    if (lane === undefined) return NOTHING;
    const whole = RosterBreakSystem.wholeOf(lane.dayBreaks, edit.drawn);
    if (whole === null) return NOTHING;
    const before = lane.breaksOwn ? lane.dayBreaks : null;
    const write = (ranges: readonly MinuteRange[] | null) =>
      this.store.setDayBreaks(
        edit.barberId,
        edit.locationId,
        edit.localDate,
        ranges,
      );
    const saved = await write(
      RosterBreakSystem.dayWith(lane.dayBreaks, whole, edit.to),
    );
    return { saved, undo: saved ? () => write(before) : null };
  }

  /** «Този и следващите»: the weekly roster from this day on; undone by the change reversed. */
  private async following(edit: BreakEdit): Promise<BreakAnswer> {
    const lane = this.laneOf(edit);
    if (lane === undefined) return NOTHING;
    const whole = RosterBreakSystem.wholeOf(lane.dayBreaks, edit.drawn);
    if (whole === null) return NOTHING;
    const change = (before: MinuteRange | null, after: MinuteRange | null) =>
      this.store.amendBreaks({
        barberId: edit.barberId,
        locationId: edit.locationId,
        fromLocalDate: edit.localDate,
        weekdays: [LocalDate.weekday(edit.localDate)],
        before,
        after,
      });
    const saved = await change(whole, edit.to);
    return { saved, undo: saved ? () => change(edit.to, whole) : null };
  }

  /** The chair's lane on the edit's own day — any visible column, not only the shown day's. */
  private laneOf(edit: {
    readonly barberId: BarberId;
    readonly localDate: LocalDate;
  }) {
    return this.store
      .dayCells()
      .find((cell) => cell.dayKey === edit.localDate)
      ?.lanes.find((lane) => lane.barberId === edit.barberId);
  }

  /** «понеделник» — the weekday the weekly break repeats on. */
  private weekdayOf(localDate: LocalDate): string {
    return this.transloco.translate(
      `staff.day.breakWeekday.${LocalDate.weekday(localDate)}`,
    );
  }
}
