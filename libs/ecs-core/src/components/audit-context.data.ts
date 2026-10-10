import type { BackfillJobKind } from '../entities/backfill-job.entity';
import type { LocationId } from '../entities/location.entity';

/**
 * The audited verbs — the stored `auditLog.action` strings of today's
 * writers, unchanged (`commit-booking.ts:217`, `staff-edit-appointment.ts:210`,
 * `transition-appointment.ts:499-506`, `mark-arrived.ts:112`,
 * `clear-arrival.ts:82`, `record-seat-tip.ts:148`,
 * `reschedule-appointment.ts:172`, `cancel-appointment.ts:226`,
 * `publish-streak-definition.use-case.ts:32-35`, `run-backfill.ts:693`,
 * `audit-profile-changes.ts:60-65`). The ONLY source of these strings; a new
 * audited act is a deliberate code change here.
 */
export const AuditAction = {
  BookingCommitted: 'booking.committed',
  BookingStaffCreated: 'booking.staff_created',
  BookingRescheduled: 'booking.rescheduled',
  BookingCancelled: 'booking.cancelled',
  BookingStaffConfirmed: 'booking.staff_confirmed',
  BookingStaffCompleted: 'booking.staff_completed',
  BookingStaffNoShow: 'booking.staff_no_show',
  BookingStaffCancelled: 'booking.staff_cancelled',
  BookingStaffReopenNoShow: 'booking.staff_reopen_no_show',
  BookingStaffReopenCompleted: 'booking.staff_reopen_completed',
  BookingStaffReinstate: 'booking.staff_reinstate',
  BookingStaffArrived: 'booking.staff_arrived',
  BookingStaffUnarrived: 'booking.staff_unarrived',
  BookingTipRecorded: 'booking.tip_recorded',
  BookingTipCleared: 'booking.tip_cleared',
  BookingStaffMove: 'booking.staff_move',
  BookingStaffResize: 'booking.staff_resize',
  BookingStaffReprice: 'booking.staff_reprice',
  BookingStaffRedurate: 'booking.staff_redurate',
  BookingStaffRestaff: 'booking.staff_restaff',
  BookingStaffRelocate: 'booking.staff_relocate',
  BookingStaffAddSeat: 'booking.staff_addSeat',
  BookingStaffRemoveSeat: 'booking.staff_removeSeat',
  BookingStaffDiscounts: 'booking.staff_discounts',
  BookingStaffVouchers: 'booking.staff_vouchers',
  /** A single staff command that named no kind. */
  BookingStaffEdit: 'booking.staff_edit',
  /** A batch of staff commands saved as one revision. */
  BookingStaffSave: 'booking.staff_save',
  LoyaltyStreakDefinitionPublished: 'loyalty.streak_definition_published',
  LoyaltyStreakDefinitionWithdrawn: 'loyalty.streak_definition_withdrawn',
  OpsBackfill: 'ops.backfill',
  ProfileCreated: 'profile.created',
  ProfileUpdated: 'profile.updated',
  ProfileDeleted: 'profile.deleted',
} as const;
export type AuditAction = (typeof AuditAction)[keyof typeof AuditAction];

/** Every audited verb, dictionary order — derived, never a second source. */
export const AUDIT_ACTIONS: readonly AuditAction[] = Object.values(AuditAction);

/*
 * The verb subsets each variant accepts. Each subset TYPE is read from the
 * `AuditAction` dictionary; each list is typed against its subset — a derived
 * list, never the source of the type.
 */

/** The two verbs that put an appointment in the book. */
export type PlacementAction =
  typeof AuditAction.BookingCommitted | typeof AuditAction.BookingStaffCreated;
export const PLACEMENT_ACTIONS: readonly PlacementAction[] = [
  AuditAction.BookingCommitted,
  AuditAction.BookingStaffCreated,
];

/** The staff lifecycle verbs of the transition callable. */
export type TransitionAction =
  | typeof AuditAction.BookingStaffConfirmed
  | typeof AuditAction.BookingStaffCompleted
  | typeof AuditAction.BookingStaffNoShow
  | typeof AuditAction.BookingStaffCancelled
  | typeof AuditAction.BookingStaffReopenNoShow
  | typeof AuditAction.BookingStaffReopenCompleted
  | typeof AuditAction.BookingStaffReinstate;
export const TRANSITION_ACTIONS: readonly TransitionAction[] = [
  AuditAction.BookingStaffConfirmed,
  AuditAction.BookingStaffCompleted,
  AuditAction.BookingStaffNoShow,
  AuditAction.BookingStaffCancelled,
  AuditAction.BookingStaffReopenNoShow,
  AuditAction.BookingStaffReopenCompleted,
  AuditAction.BookingStaffReinstate,
];

export type ArrivalAction =
  | typeof AuditAction.BookingStaffArrived
  | typeof AuditAction.BookingStaffUnarrived;
export const ARRIVAL_ACTIONS: readonly ArrivalAction[] = [
  AuditAction.BookingStaffArrived,
  AuditAction.BookingStaffUnarrived,
];

export type TipAction =
  typeof AuditAction.BookingTipRecorded | typeof AuditAction.BookingTipCleared;
export const TIP_ACTIONS: readonly TipAction[] = [
  AuditAction.BookingTipRecorded,
  AuditAction.BookingTipCleared,
];

/** The staff edit verbs — one per edit command kind, plus `edit` and `save`. */
export type StaffEditAction =
  | typeof AuditAction.BookingStaffMove
  | typeof AuditAction.BookingStaffResize
  | typeof AuditAction.BookingStaffReprice
  | typeof AuditAction.BookingStaffRedurate
  | typeof AuditAction.BookingStaffRestaff
  | typeof AuditAction.BookingStaffRelocate
  | typeof AuditAction.BookingStaffAddSeat
  | typeof AuditAction.BookingStaffRemoveSeat
  | typeof AuditAction.BookingStaffDiscounts
  | typeof AuditAction.BookingStaffVouchers
  | typeof AuditAction.BookingStaffEdit
  | typeof AuditAction.BookingStaffSave;
export const STAFF_EDIT_ACTIONS: readonly StaffEditAction[] = [
  AuditAction.BookingStaffMove,
  AuditAction.BookingStaffResize,
  AuditAction.BookingStaffReprice,
  AuditAction.BookingStaffRedurate,
  AuditAction.BookingStaffRestaff,
  AuditAction.BookingStaffRelocate,
  AuditAction.BookingStaffAddSeat,
  AuditAction.BookingStaffRemoveSeat,
  AuditAction.BookingStaffDiscounts,
  AuditAction.BookingStaffVouchers,
  AuditAction.BookingStaffEdit,
  AuditAction.BookingStaffSave,
];

export type ProfileAction =
  | typeof AuditAction.ProfileCreated
  | typeof AuditAction.ProfileUpdated
  | typeof AuditAction.ProfileDeleted;
export const PROFILE_ACTIONS: readonly ProfileAction[] = [
  AuditAction.ProfileCreated,
  AuditAction.ProfileUpdated,
  AuditAction.ProfileDeleted,
];

/** How an ops backfill call ended — the stored `outcome` strings, unchanged. */
export const BackfillOutcome = {
  /** The call threw; `failureCode` says why. */
  Failed: 'failed',
  /** The walk reached the end. */
  Complete: 'complete',
  /** A page finished; the job continues from `cursor`. */
  Partial: 'partial',
} as const;
export type BackfillOutcome =
  (typeof BackfillOutcome)[keyof typeof BackfillOutcome];

/**
 * What an audit row says about its act — a `kind`-discriminated union whose
 * `kind` repeats the row's `action`, **every field present per variant**
 * (`null` for n/a), never an open bag of optional strings (2^n hidden
 * classes; blueprint §2.7). Today's `Record<string, string>` contexts
 * (`audit-log-document.ts:51`) become typed fields: counts and revisions are
 * numbers, lists are arrays, flags are booleans. Ids and CODES only (T5,
 * R36) — never a sentence somebody typed. Verbs that carry the same facts
 * share one variant.
 */
export type AuditContext =
  | AuditContext.Placement
  | AuditContext.StaffEdit
  | AuditContext.Rescheduled
  | AuditContext.Cancelled
  | AuditContext.Transition
  | AuditContext.Arrival
  | AuditContext.Tip
  | AuditContext.StreakPublished
  | AuditContext.StreakWithdrawn
  | AuditContext.Backfill
  | AuditContext.Profile;

export const AuditContext = {
  placement(
    action: PlacementAction,
    locationId: LocationId,
  ): AuditContext.Placement {
    return { kind: action, locationId };
  },
  staffEdit(action: StaffEditAction, revision: number): AuditContext.StaffEdit {
    return { kind: action, revision };
  },
  rescheduled(
    revision: number,
    loggedOnRetry: boolean,
  ): AuditContext.Rescheduled {
    return { kind: AuditAction.BookingRescheduled, revision, loggedOnRetry };
  },
  cancelled(reason: string): AuditContext.Cancelled {
    return { kind: AuditAction.BookingCancelled, reason };
  },
  transition(
    action: TransitionAction,
    reason: string | null,
    seatId: string | null,
  ): AuditContext.Transition {
    return { kind: action, reason, seatId };
  },
  arrival(action: ArrivalAction): AuditContext.Arrival {
    return { kind: action };
  },
  tip(action: TipAction, seatId: string): AuditContext.Tip {
    return { kind: action, seatId };
  },
  streakPublished(
    facts: Omit<AuditContext.StreakPublished, 'kind'>,
  ): AuditContext.StreakPublished {
    return {
      kind: AuditAction.LoyaltyStreakDefinitionPublished,
      from: facts.from,
      to: facts.to,
      effectiveFrom: facts.effectiveFrom,
      transition: facts.transition,
      direction: facts.direction,
      changed: [...facts.changed],
      replaced: facts.replaced,
    };
  },
  streakWithdrawn(
    facts: Omit<AuditContext.StreakWithdrawn, 'kind'>,
  ): AuditContext.StreakWithdrawn {
    return {
      kind: AuditAction.LoyaltyStreakDefinitionWithdrawn,
      from: facts.from,
      to: facts.to,
      effectiveFrom: facts.effectiveFrom,
      transition: facts.transition,
    };
  },
  backfill(facts: Omit<AuditContext.Backfill, 'kind'>): AuditContext.Backfill {
    return {
      kind: AuditAction.OpsBackfill,
      job: facts.job,
      outcome: facts.outcome,
      failureCode: facts.failureCode,
      processed: facts.processed,
      storedClients: facts.storedClients,
      done: facts.done,
      budgetSpent: facts.budgetSpent,
      cursor: facts.cursor,
    };
  },
  /** Copies the field list, so a caller's later mutation cannot rewrite the row. */
  profile(
    action: ProfileAction,
    fields: readonly string[],
  ): AuditContext.Profile {
    return { kind: action, fields: [...fields] };
  },

  /** The edge guard for a stored or submitted verb. */
  isAuditAction(value: unknown): value is AuditAction {
    for (let i = 0; i < AUDIT_ACTIONS.length; i++) {
      if (AUDIT_ACTIONS[i] === value) return true;
    }
    return false;
  },
} as const;

export namespace AuditContext {
  /** An appointment put in the book — by the client or by the shop. */
  export type Placement = {
    readonly kind: PlacementAction;
    readonly locationId: LocationId;
  };
  /** A staff edit; `revision` is the one the save stamped. */
  export type StaffEdit = {
    readonly kind: StaffEditAction;
    readonly revision: number;
  };
  /** A move; `loggedOnRetry` when the row was written by a replay of it. */
  export type Rescheduled = {
    readonly kind: typeof AuditAction.BookingRescheduled;
    readonly revision: number;
    readonly loggedOnRetry: boolean;
  };
  /** A client cancellation; `reason` is the cancellation reason CODE. */
  export type Cancelled = {
    readonly kind: typeof AuditAction.BookingCancelled;
    readonly reason: string;
  };
  /** A staff lifecycle verb; `reason` for a cancel, `seatId` for a per-seat act. */
  export type Transition = {
    readonly kind: TransitionAction;
    readonly reason: string | null;
    readonly seatId: string | null;
  };
  /** Arrival stamped or cleared — the verb is the whole fact. */
  export type Arrival = {
    readonly kind: ArrivalAction;
  };
  /** A tip recorded or cleared on one seat — the act, never the amount. */
  export type Tip = {
    readonly kind: TipAction;
    readonly seatId: string;
  };
  /** A streak rule published: versions, the day it takes effect, what moved. */
  export type StreakPublished = {
    readonly kind: typeof AuditAction.LoyaltyStreakDefinitionPublished;
    readonly from: number;
    readonly to: number;
    /** The day key the new version takes effect. */
    readonly effectiveFrom: string;
    readonly transition: string;
    readonly direction: string;
    readonly changed: readonly string[];
    /** The waiting version this publish called off, if any. */
    readonly replaced: number | null;
  };
  /** A waiting streak rule called off before its day. */
  export type StreakWithdrawn = {
    readonly kind: typeof AuditAction.LoyaltyStreakDefinitionWithdrawn;
    readonly from: number;
    readonly to: number;
    readonly effectiveFrom: string;
    readonly transition: string;
  };
  /** One ops backfill call; the page figures are `null` when it threw. */
  export type Backfill = {
    readonly kind: typeof AuditAction.OpsBackfill;
    readonly job: BackfillJobKind;
    readonly outcome: BackfillOutcome;
    readonly failureCode: string | null;
    readonly processed: number | null;
    readonly storedClients: number | null;
    readonly done: boolean | null;
    readonly budgetSpent: boolean | null;
    readonly cursor: string | null;
  };
  /** A `users/{uid}` write; `fields` are the changed field names. */
  export type Profile = {
    readonly kind: ProfileAction;
    readonly fields: readonly string[];
  };
}
