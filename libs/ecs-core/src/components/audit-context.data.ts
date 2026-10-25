import type { StreakRuleDirection } from './streak-rule-direction.data';
import type { StreakRuleParameter } from './streak-rule-parameter.data';
import type { StreakTransition } from './streak-transition.data';
import type { BackfillJobName } from './backfill-job-name.data';
import {
  type LocalDate,
  type LocationId,
  type SeatId,
  Tag,
} from '@core/primitives';
import type { ArrivalAction } from './arrival-action.data';
import type { PlacementAction } from './placement-action.data';
import type { CancellationReason } from './cancellation-reason.data';
import type { ProfileAction } from './profile-action.data';
import type { RegistrationField } from './registration.data';
import type { StaffEditAction } from './staff-edit-action.data';
import type { TipAction } from './tip-action.data';
import type { TransitionAction } from './transition-action.data';

/**
 * The audited verbs — the ONLY source of these strings, the discriminator
 * `auditAction` of {@link AuditContext}. Today's writers' stored
 * `auditLog.action` strings (`commit-booking.ts:217`,
 * `staff-edit-appointment.ts:210`, `transition-appointment.ts:499-506`,
 * `mark-arrived.ts:112`, `clear-arrival.ts:82`, `record-seat-tip.ts:148`,
 * `reschedule-appointment.ts:172`, `cancel-appointment.ts:226`,
 * `publish-streak-definition.pipeline.ts`, `run-backfill.ts:693`,
 * `audit-profile-changes.ts:60-65`) upper-snaked, dots and camel humps to
 * `_` (flatten-spec §3.7); the stored bytes were the dotted strings until
 * the governance flip, which the legacy shims converted. A new audited act
 * is a deliberate code change here.
 */
export const AuditAction = {
  BookingCommitted: 'BOOKING_COMMITTED',
  BookingStaffCreated: 'BOOKING_STAFF_CREATED',
  BookingRescheduled: 'BOOKING_RESCHEDULED',
  BookingCancelled: 'BOOKING_CANCELLED',
  BookingStaffConfirmed: 'BOOKING_STAFF_CONFIRMED',
  BookingStaffCompleted: 'BOOKING_STAFF_COMPLETED',
  BookingStaffNoShow: 'BOOKING_STAFF_NO_SHOW',
  BookingStaffCancelled: 'BOOKING_STAFF_CANCELLED',
  BookingStaffReopenNoShow: 'BOOKING_STAFF_REOPEN_NO_SHOW',
  BookingStaffReopenCompleted: 'BOOKING_STAFF_REOPEN_COMPLETED',
  BookingStaffReinstate: 'BOOKING_STAFF_REINSTATE',
  BookingStaffArrived: 'BOOKING_STAFF_ARRIVED',
  BookingStaffUnarrived: 'BOOKING_STAFF_UNARRIVED',
  BookingTipRecorded: 'BOOKING_TIP_RECORDED',
  BookingTipCleared: 'BOOKING_TIP_CLEARED',
  BookingStaffMove: 'BOOKING_STAFF_MOVE',
  BookingStaffResize: 'BOOKING_STAFF_RESIZE',
  BookingStaffReprice: 'BOOKING_STAFF_REPRICE',
  BookingStaffRedurate: 'BOOKING_STAFF_REDURATE',
  BookingStaffRestaff: 'BOOKING_STAFF_RESTAFF',
  BookingStaffRelocate: 'BOOKING_STAFF_RELOCATE',
  BookingStaffAddSeat: 'BOOKING_STAFF_ADD_SEAT',
  BookingStaffRemoveSeat: 'BOOKING_STAFF_REMOVE_SEAT',
  BookingStaffDiscounts: 'BOOKING_STAFF_DISCOUNTS',
  BookingStaffVouchers: 'BOOKING_STAFF_VOUCHERS',
  /** A single staff command that named no kind. */
  BookingStaffEdit: 'BOOKING_STAFF_EDIT',
  /** A batch of staff commands saved as one revision. */
  BookingStaffSave: 'BOOKING_STAFF_SAVE',
  LoyaltyStreakDefinitionPublished: 'LOYALTY_STREAK_DEFINITION_PUBLISHED',
  LoyaltyStreakDefinitionWithdrawn: 'LOYALTY_STREAK_DEFINITION_WITHDRAWN',
  OpsBackfill: 'OPS_BACKFILL',
  ProfileCreated: 'PROFILE_CREATED',
  ProfileUpdated: 'PROFILE_UPDATED',
  ProfileDeleted: 'PROFILE_DELETED',
} as const;
export type AuditAction = (typeof AuditAction)[keyof typeof AuditAction];

/** How an ops backfill call ended — the field `backfillOutcome`. */
export const BackfillOutcome = {
  /** The call threw; `backfillFailureCode` says why. */
  Failed: 'FAILED',
  /** The walk reached the end. */
  Complete: 'COMPLETE',
  /** A page finished; the job continues from `backfillCursor`. */
  Partial: 'PARTIAL',
} as const;
export type BackfillOutcome =
  (typeof BackfillOutcome)[keyof typeof BackfillOutcome];

/**
 * What an audit row says about its act — a union of FLAT variant slices
 * discriminated by `auditAction` alone (Law 6: the verb is the context's
 * discriminator and is never repeated elsewhere in the row), intersected at
 * the root of `AuditEntry`. Every variant-only field carries its variant's
 * prefix (`placementLocationId`, `editRevision`, `streakFromVersion`,
 * `backfillOutcome`, …) so the slice never collides with the actor, target
 * or meta slices. Every field present per variant (`null` for n/a), never an
 * open bag of optional strings; ids and CODES only (T5, R36) — never a
 * sentence somebody typed. Verbs that carry the same facts share one variant.
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
  /** Every audited verb, dictionary order — derived, never a second source. */
  ACTIONS: Tag.values(AuditAction),

  placement(
    auditAction: PlacementAction,
    placementLocationId: LocationId,
  ): AuditContext.Placement {
    return { auditAction, placementLocationId };
  },
  staffEdit(
    auditAction: StaffEditAction,
    editRevision: number,
  ): AuditContext.StaffEdit {
    return { auditAction, editRevision };
  },
  rescheduled(
    rescheduleRevision: number,
    loggedOnRetry: boolean,
  ): AuditContext.Rescheduled {
    return {
      auditAction: AuditAction.BookingRescheduled,
      rescheduleRevision,
      loggedOnRetry,
    };
  },
  cancelled(cancellationReason: CancellationReason): AuditContext.Cancelled {
    return { auditAction: AuditAction.BookingCancelled, cancellationReason };
  },
  transition(
    auditAction: TransitionAction,
    transitionReason: CancellationReason | null,
    transitionSeatId: SeatId | null,
  ): AuditContext.Transition {
    return { auditAction, transitionReason, transitionSeatId };
  },
  arrival(auditAction: ArrivalAction): AuditContext.Arrival {
    return { auditAction };
  },
  tip(auditAction: TipAction, tipSeatId: SeatId): AuditContext.Tip {
    return { auditAction, tipSeatId };
  },
  streakPublished(
    facts: Omit<AuditContext.StreakPublished, 'auditAction'>,
  ): AuditContext.StreakPublished {
    return {
      auditAction: AuditAction.LoyaltyStreakDefinitionPublished,
      streakFromVersion: facts.streakFromVersion,
      streakToVersion: facts.streakToVersion,
      streakEffectiveFrom: facts.streakEffectiveFrom,
      streakTransition: facts.streakTransition,
      streakRuleDirection: facts.streakRuleDirection,
      streakChanged: [...facts.streakChanged],
      streakReplacedVersion: facts.streakReplacedVersion,
    };
  },
  streakWithdrawn(
    facts: Omit<AuditContext.StreakWithdrawn, 'auditAction'>,
  ): AuditContext.StreakWithdrawn {
    return {
      auditAction: AuditAction.LoyaltyStreakDefinitionWithdrawn,
      streakFromVersion: facts.streakFromVersion,
      streakToVersion: facts.streakToVersion,
      streakEffectiveFrom: facts.streakEffectiveFrom,
      streakTransition: facts.streakTransition,
    };
  },
  backfill(
    facts: Omit<AuditContext.Backfill, 'auditAction'>,
  ): AuditContext.Backfill {
    return {
      auditAction: AuditAction.OpsBackfill,
      backfillJobName: facts.backfillJobName,
      backfillOutcome: facts.backfillOutcome,
      backfillFailureCode: facts.backfillFailureCode,
      backfillProcessed: facts.backfillProcessed,
      backfillStoredClients: facts.backfillStoredClients,
      backfillDone: facts.backfillDone,
      backfillBudgetSpent: facts.backfillBudgetSpent,
      backfillCursor: facts.backfillCursor,
    };
  },
  /** Copies the field list, so a caller's later mutation cannot rewrite the row. */
  profile(
    auditAction: ProfileAction,
    profileFields: readonly RegistrationField[],
  ): AuditContext.Profile {
    return { auditAction, profileFields: [...profileFields] };
  },

  /** The edge guard for a stored or submitted verb. */
  isAuditAction(value: unknown): value is AuditAction {
    return Tag.has(AuditAction, value);
  },
} as const;

export namespace AuditContext {
  /** An appointment put in the book — by the client or by the shop. */
  export type Placement = {
    readonly auditAction: PlacementAction;
    readonly placementLocationId: LocationId;
  };
  /** A staff edit; `editRevision` is the one the save stamped. */
  export type StaffEdit = {
    readonly auditAction: StaffEditAction;
    readonly editRevision: number;
  };
  /** A move; `loggedOnRetry` when the row was written by a replay of it. */
  export type Rescheduled = {
    readonly auditAction: typeof AuditAction.BookingRescheduled;
    readonly rescheduleRevision: number;
    readonly loggedOnRetry: boolean;
  };
  /** A client cancellation; `cancellationReason` is the cancellation reason CODE. */
  export type Cancelled = {
    readonly auditAction: typeof AuditAction.BookingCancelled;
    readonly cancellationReason: CancellationReason;
  };
  /** A staff lifecycle verb; the reason for a cancel, the seat for a per-seat act. */
  export type Transition = {
    readonly auditAction: TransitionAction;
    readonly transitionReason: CancellationReason | null;
    readonly transitionSeatId: SeatId | null;
  };
  /** Arrival stamped or cleared — the verb is the whole fact. */
  export type Arrival = {
    readonly auditAction: ArrivalAction;
  };
  /** A tip recorded or cleared on one seat — the act, never the amount. */
  export type Tip = {
    readonly auditAction: TipAction;
    readonly tipSeatId: SeatId;
  };
  /** A streak rule published: versions, the day it takes effect, what moved. */
  export type StreakPublished = {
    readonly auditAction: typeof AuditAction.LoyaltyStreakDefinitionPublished;
    readonly streakFromVersion: number;
    readonly streakToVersion: number;
    /** The shop day the new version takes effect. */
    readonly streakEffectiveFrom: LocalDate;
    readonly streakTransition: StreakTransition;
    readonly streakRuleDirection: StreakRuleDirection;
    readonly streakChanged: readonly StreakRuleParameter[];
    /** The waiting version this publish called off, if any. */
    readonly streakReplacedVersion: number | null;
  };
  /** A waiting streak rule called off before its day. */
  export type StreakWithdrawn = {
    readonly auditAction: typeof AuditAction.LoyaltyStreakDefinitionWithdrawn;
    readonly streakFromVersion: number;
    readonly streakToVersion: number;
    readonly streakEffectiveFrom: LocalDate;
    readonly streakTransition: StreakTransition;
  };
  /** One ops backfill call; the page figures are `null` when it threw. */
  export type Backfill = {
    readonly auditAction: typeof AuditAction.OpsBackfill;
    readonly backfillJobName: BackfillJobName;
    readonly backfillOutcome: BackfillOutcome;
    readonly backfillFailureCode: string | null;
    readonly backfillProcessed: number | null;
    readonly backfillStoredClients: number | null;
    readonly backfillDone: boolean | null;
    readonly backfillBudgetSpent: boolean | null;
    readonly backfillCursor: string | null;
  };
  /** A `users/{uid}` write; `profileFields` are the changed field names. */
  export type Profile = {
    readonly auditAction: ProfileAction;
    readonly profileFields: readonly RegistrationField[];
  };
}
