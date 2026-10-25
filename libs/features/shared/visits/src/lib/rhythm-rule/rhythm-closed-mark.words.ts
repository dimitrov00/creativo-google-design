import {
  FreezeReason,
  StreakPeriodMark,
  type StreakTrackMark,
  StreakTrackMarkKind,
} from '@core/components';
import type { LocalDate } from '@core/primitives';
import {
  type StreakPeriodReasonWord,
  streakPeriodMarkWords,
  streakPeriodReasonWords,
} from '@creativo/infrastructure/i18n';
import type { UiStreakMark, UiStreakPeriod } from '@creativo/ui/controls';

/*
 * A CLOSED PERIOD OF THE RHYTHM'S TRACK, IN WORDS (client-card revision 3
 * §2.6.1, §3.11) — the ONE word source the two tracks print it from: the
 * staff client card's wallet (`wallet.presenter.ts`) and the admin rhythm
 * page's sample run (`admin-rhythm.words.ts`). Which marks exist, on which
 * day and for what reason is `StreakSystem.track`'s answer; this file only
 * words a mark it is handed (Law 10.2).
 *
 * The two surfaces differ in how they PRINT, never in what they say, so
 * each difference is a parameter (`RhythmClosedMarkForms`): the id's suffix
 * (the admin's sample tells two marks of one day apart by their place in
 * the run; the card's ids are the mark and its day alone), the month's form
 * and the day's form; and each surface's own sentences (the admin's
 * catalogue `translate`, the card's words table) arrive as
 * `RhythmClosedMarkSentences`. The mark the DS track draws is the one table
 * `streakPeriodMarkWords`, typed against the DS's own words.
 */

/** A track mark that closes a period: every mark but the open one's `CURRENT`. */
export type RhythmClosedMark = StreakTrackMark & {
  readonly streakTrackMarkKind: StreakPeriodMark;
};

/** The mark closes a period — every mark but the open one's `CURRENT`. */
export function isRhythmClosedMark(
  mark: StreakTrackMark,
): mark is RhythmClosedMark {
  return mark.streakTrackMarkKind !== StreakTrackMarkKind.Current;
}

/** A surface's sentences for a closed period, one per mark, and a covering reason's word. */
export type RhythmClosedMarkSentences = {
  /** «посещение · септември, 4.09» — `period` the month, `date` the visit's day. */
  readonly kept: (period: string, date: string) => string;
  readonly repaired: (period: string) => string;
  /** `reason` is {@link RhythmClosedMarkSentences.reason}'s word. */
  readonly protected: (period: string, reason: string) => string;
  readonly missed: (period: string) => string;
  /** Why a protected period was covered, by its `clientCard.rhythm.reason.<word>` segment. */
  readonly reason: (word: StreakPeriodReasonWord) => string;
};

/** How a surface prints a closed period: the id's suffix, and the month's and the day's forms of the mark's day. */
export type RhythmClosedMarkForms = {
  /** Appended to `<mark>-<day>`: `''` on the card, `-<place in the run>` on the admin's sample. */
  readonly idSuffix: string;
  /** The month the period is said in («септември»). */
  readonly month: (on: LocalDate) => string;
  /** The day a kept visit is said on («4.09»). */
  readonly day: (on: LocalDate) => string;
};

/**
 * A covering reason as its word: one the projection did not name — and the
 * open phase's `EXCUSE`, which a closed period never holds — is a
 * protection's.
 */
function reasonWordOf(mark: RhythmClosedMark): StreakPeriodReasonWord {
  const reason = mark.reason;
  return reason === null || reason === FreezeReason.Excuse
    ? streakPeriodReasonWords[FreezeReason.Freeze]
    : // eslint-disable-next-line security/detect-object-injection -- `reason` is a member of the closed dictionary the table is total over.
      streakPeriodReasonWords[reason];
}

/**
 * A closed period as the DS track draws it: its id (`<mark>-<day>` and the
 * surface's suffix), the mark, no caption (a visit's caption is chosen with
 * its neighbours', by the surface) and the period said in the surface's own
 * sentences.
 */
export function rhythmClosedMarkPeriod(
  mark: RhythmClosedMark,
  forms: RhythmClosedMarkForms,
  sentences: RhythmClosedMarkSentences,
): UiStreakPeriod {
  const period = forms.month(mark.on);
  const drawn: UiStreakMark = streakPeriodMarkWords[mark.streakTrackMarkKind];
  const id = `${drawn}-${mark.on}${forms.idSuffix}`;
  switch (mark.streakTrackMarkKind) {
    case StreakPeriodMark.Kept:
      return {
        id,
        mark: drawn,
        caption: '',
        description: sentences.kept(period, forms.day(mark.on)),
      };
    case StreakPeriodMark.Repaired:
      return {
        id,
        mark: drawn,
        caption: '',
        description: sentences.repaired(period),
      };
    case StreakPeriodMark.Protected:
      return {
        id,
        mark: drawn,
        caption: '',
        description: sentences.protected(
          period,
          sentences.reason(reasonWordOf(mark)),
        ),
      };
    case StreakPeriodMark.Missed:
      return {
        id,
        mark: drawn,
        caption: '',
        description: sentences.missed(period),
      };
  }
}
