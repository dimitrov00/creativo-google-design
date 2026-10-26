import type { BarberId } from '@core/primitives';
import { pluralForm } from '@creativo/infrastructure/i18n';
import {
  type DayHealthChair,
  type DayHealthRowVm,
  DayHealthTestId,
  type DayHealthWords,
} from './day-health.vm';

/*
 * THE DAY'S HEALTH, WORDED (OR-2). On a schedule a missing booking is the
 * most plausible lie, so a chair whose day the sheet could not read in full
 * is said on the day's all-day strip — never drawn as free time, never
 * listed as off.
 *
 * It DECIDES NOTHING (Law 10.2). The store states each lane's facts as it
 * read them — the read FAILED (`failed`: a refused listen, or a day whose
 * every visit the guard refused), or it dropped `unreadable` visits — and
 * this words them, one row per chair that has something to say, in the
 * lanes' own order. A failed lane read no visits, so it has no count to
 * word: its row is the failure.
 */

/** A lane as the rows read it — the store's `BarberDayLane`, as it is (Law 3, zero inbound mapping). */
export interface DayHealthLane {
  readonly barberId: BarberId;
  readonly failed: boolean;
  readonly unreadable: number;
}

/** What the rows are worded from. */
export interface DayHealthInput {
  /** The day's lanes, in the order the sheet draws its chairs. */
  readonly lanes: readonly DayHealthLane[];
  /** Each chair's name and tone; a chair missing here is named by its id. */
  readonly chairs: ReadonlyMap<BarberId, DayHealthChair>;
  readonly words: DayHealthWords;
}

/**
 * How a host's catalogue answers — Transloco's `translate`, or anything
 * shaped like it (a spec's own reading of the catalogue).
 */
export type DayHealthTranslate = (
  key: string,
  params?: Readonly<Record<string, string | number>>,
) => string;

/** The rows' words from the catalogue, read once — the count's form by `pluralForm`. */
export function dayHealthWordsOf(
  translate: DayHealthTranslate,
  lang: string,
): DayHealthWords {
  return {
    unreadable: (count) =>
      translate(`staff.day.unreadable.${pluralForm(count, lang)}`, { count }),
    unreadableHint: translate('staff.day.unreadableHint'),
    laneFailedBadge: translate('staff.day.laneFailedBadge'),
    laneFailed: translate('staff.day.laneFailed'),
  };
}

/** One row per chair whose day was not read in full — none on a clean day. */
export function dayHealthRowsOf(input: DayHealthInput): DayHealthRowVm[] {
  const { words } = input;
  const rows: DayHealthRowVm[] = [];
  for (const lane of input.lanes) {
    if (!lane.failed && lane.unreadable === 0) continue;
    const chair = input.chairs.get(lane.barberId);
    const name = chair?.name ?? lane.barberId;
    const tone = chair?.tone ?? 0;
    if (lane.failed) {
      rows.push({
        barberId: lane.barberId,
        name,
        detail: null,
        tone,
        meta: words.laneFailedBadge,
        label: words.laneFailed,
        testId: DayHealthTestId.Failed,
      });
      continue;
    }
    const count = words.unreadable(lane.unreadable);
    rows.push({
      barberId: lane.barberId,
      name,
      // The count under the name, so a partial drop shows how many (DEP-F2);
      // what to do about it is the meta (OR-2).
      detail: count,
      tone,
      meta: words.unreadableHint,
      // The count, then what to do about it — the failed row's
      // `laneFailed` sentence, in the same two beats.
      label: `${count}. ${words.unreadableHint}.`,
      testId: DayHealthTestId.Unreadable,
    });
  }
  return rows;
}
