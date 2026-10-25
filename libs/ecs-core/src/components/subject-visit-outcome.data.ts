import type { AccountSeat } from './account-seat.data';
import type { SeatOutcome } from './seat-outcome.data';

/*
 * What one appointment was, for one person — the outcome a
 * `ClientStatsSystem` visit carries (`SubjectVisit.outcome`), read by the
 * records and the visit story too. Moved out of `client-stats.system.ts`
 * (pass D, S-21; D-7.4: a tag dictionary and the union it types are
 * components), values unchanged.
 */

/**
 * What one appointment was, for one person — the ONLY source of these
 * strings, the field `subjectVisitOutcome`.
 */
export const SubjectVisitOutcome = {
  Worked: 'WORKED',
  NoShow: 'NO_SHOW',
  Cancelled: 'CANCELLED',
  Open: 'OPEN',
} as const;
export type SubjectVisitOutcome =
  (typeof SubjectVisitOutcome)[keyof typeof SubjectVisitOutcome];

/** One person's story of one appointment, discriminated by `subjectVisitOutcome`. */
export type SubjectVisitOutcomeState =
  | SubjectVisitOutcomeState.Worked
  | SubjectVisitOutcomeState.NoShow
  | SubjectVisitOutcomeState.Cancelled
  | SubjectVisitOutcomeState.Open;

const WORKED: SubjectVisitOutcomeState.Worked = {
  subjectVisitOutcome: SubjectVisitOutcome.Worked,
};
const NO_SHOW: SubjectVisitOutcomeState.NoShow = {
  subjectVisitOutcome: SubjectVisitOutcome.NoShow,
};
const OPEN: SubjectVisitOutcomeState.Open = {
  subjectVisitOutcome: SubjectVisitOutcome.Open,
};

export const SubjectVisitOutcomeState = {
  /** A seat of theirs was worked: a visit. */
  WORKED,
  /** No seat worked, none open, one a no-show. */
  NO_SHOW,
  /** A seat of theirs is still scheduled. */
  OPEN,

  /** Every seat called off — decided by the one called off LAST. */
  cancelled(
    decisive: AccountSeat & SeatOutcome.Cancelled,
  ): SubjectVisitOutcomeState.Cancelled {
    return { subjectVisitOutcome: SubjectVisitOutcome.Cancelled, decisive };
  },
} as const;

export namespace SubjectVisitOutcomeState {
  export type Worked = {
    readonly subjectVisitOutcome: typeof SubjectVisitOutcome.Worked;
  };
  export type NoShow = {
    readonly subjectVisitOutcome: typeof SubjectVisitOutcome.NoShow;
  };
  export type Cancelled = {
    readonly subjectVisitOutcome: typeof SubjectVisitOutcome.Cancelled;
    /** The seat called off LAST — the cancellation that ended the visit. */
    readonly decisive: AccountSeat & SeatOutcome.Cancelled;
  };
  export type Open = {
    readonly subjectVisitOutcome: typeof SubjectVisitOutcome.Open;
  };
}
