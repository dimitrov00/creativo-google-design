import type { StreakRuleDirection } from './streak-rule-direction.data';
import type { StreakRuleParameter } from './streak-rule-parameter.data';
import type { StreakTransition } from './streak-transition.data';
import type { BackfillJobName } from './backfill-job-name.data';
import {
  type IdentifierChannel,
  type ImpersonationSessionId,
  type LocalDate,
  type LocationId,
  type SeatId,
  Tag,
  type UtcEpochMs,
} from '@core/primitives';
import type { AccountStatus } from './account-status.data';
import type { ArrivalAction } from './arrival-action.data';
import type { AuditedProfileField } from './audited-profile-field.data';
import type { CancellationDelta } from './cancellation-delta.data';
import type { PlacementAction } from './placement-action.data';
import type { CancellationReason } from './cancellation-reason.data';
import type { ImpersonationEndReason } from './end-reason-fields.data';
import type { ErasureAction } from './erasure-action.data';
import { ErasureCensus } from './erasure-census.data';
import type { GovernedAction } from './governed-action.data';
import type { GovernedCollection } from './governed-collection.data';
import type { ImpersonationScope } from './impersonation-scope.data';
import type { OtpDestinationType } from './otp-destination-type.data';
import type { OtpPurpose } from './otp-purpose.data';
import type { OtpRefusalReason } from './otp-refusal-reason.data';
import type { ProfileAction } from './profile-action.data';
import type { Role } from './role.data';
import type { RescheduleDelta } from './reschedule-delta.data';
import type { SessionKind } from './session-kind.data';
import type { StaffEditAction } from './staff-edit-action.data';
import type { StaffEditDelta } from './staff-edit-delta.data';
import type { TipAction } from './tip-action.data';
import type { TipDelta } from './tip-delta.data';
import type { TransitionAction } from './transition-action.data';
import type { TransitionDelta } from './transition-delta.data';

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
 * is a deliberate code change here — the impersonation and governed-document
 * verbs were added by audit-hardening WS-3 (DEP-17), the sign-in verbs
 * (`IDENTITY_*`) by audit-hardening Phase 3 (P3-DEP-7), the data-subject
 * verbs (`PRIVACY_*`) by its WS-C (P3-DEP-10) and WS-D (P3-DEP-18).
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
  /**
   * An admin changed an account's roles through `setRoles` (security
   * hardening S-WS-E, S-RU-9): written inside the `users` commit, credited
   * to the admin, the roles before / after as tags (`profileRolesFrom/To`).
   */
  ProfileRolesChanged: 'PROFILE_ROLES_CHANGED',
  /** An admin opened an impersonation session (no REVOKED verb: nothing revokes). */
  GovernanceImpersonationStarted: 'GOVERNANCE_IMPERSONATION_STARTED',
  /** A session was ended — by an admin, or found lapsed at the end call. */
  GovernanceImpersonationEnded: 'GOVERNANCE_IMPERSONATION_ENDED',
  /** A governed document was created (`GovernedCollection`, never USERS). */
  GovernedDocCreated: 'GOVERNED_DOC_CREATED',
  GovernedDocUpdated: 'GOVERNED_DOC_UPDATED',
  GovernedDocDeleted: 'GOVERNED_DOC_DELETED',
  /** A one-time-code challenge saved (`requestOtpChallenge`, Phase 3 WS-B). */
  IdentityOtpRequested: 'IDENTITY_OTP_REQUESTED',
  /** A challenge consumed by the right code. */
  IdentityOtpVerified: 'IDENTITY_OTP_VERIFIED',
  /** A wrong code recorded against a challenge (`otpRefusalReason` says whether it locked it). */
  IdentityOtpRefused: 'IDENTITY_OTP_REFUSED',
  /** A sign-in token answered to the caller who proved the destination (`verifyOtpChallenge`). */
  IdentitySessionIssued: 'IDENTITY_SESSION_ISSUED',
  /** An account's first registration completed (`completeRegistration`). */
  IdentityRegistrationCompleted: 'IDENTITY_REGISTRATION_COMPLETED',
  /** An admin exported a client's data (`exportClientData`, Phase 3 WS-C) — counts only. */
  PrivacyClientExported: 'PRIVACY_CLIENT_EXPORTED',
  /**
   * An admin's erasure swept, BEFORE its stamp, the contacts of visits that
   * carry the person's contact values (P3-DEP-28, P3-DEP-33): written in the
   * sweep's first commit that lands, once per act — the census BEFORE,
   * counts only.
   */
  PrivacyClientErasureSwept: 'PRIVACY_CLIENT_ERASURE_SWEPT',
  /**
   * An admin's erasure began (`eraseClient`, Phase 3 WS-D): the stamp commit
   * cleared the record and the account — the census BEFORE, counts only.
   */
  PrivacyClientErasureStarted: 'PRIVACY_CLIENT_ERASURE_STARTED',
  /** The erasure completed: nothing personal left — the residue census AFTER. */
  PrivacyClientErased: 'PRIVACY_CLIENT_ERASED',
  /** An erased record's sweep found residue and cleared it — the census BEFORE the sweep (P3-L-19). */
  PrivacyClientErasureReswept: 'PRIVACY_CLIENT_ERASURE_RESWEPT',
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
 * The booking verbs that change a value also carry its before / after as a
 * flat delta slice intersected into their variant (audit-hardening WS-2,
 * RU-12: `RescheduleDelta`, `StaffEditDelta`, `TipDelta`, `TransitionDelta`,
 * `CancellationDelta`) — money, time and ids only, computed by
 * `AuditDeltaSystem` from the entities the act already read.
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
  | AuditContext.Profile
  | AuditContext.ImpersonationStarted
  | AuditContext.ImpersonationEnded
  | AuditContext.Governed
  | AuditContext.OtpRequested
  | AuditContext.OtpVerified
  | AuditContext.OtpRefused
  | AuditContext.SessionIssued
  | AuditContext.RegistrationCompleted
  | AuditContext.ClientExported
  | AuditContext.ClientErasure;

/** A profile row's four tag fields when neither `roles` nor `accountStatus` changed. */
const NO_TAGS: Omit<AuditContext.Profile, 'auditAction' | 'profileFields'> = {
  profileRolesFrom: null,
  profileRolesTo: null,
  profileAccountStatusFrom: null,
  profileAccountStatusTo: null,
};

export const AuditContext = {
  /** Every audited verb, dictionary order — derived, never a second source. */
  ACTIONS: Tag.values(AuditAction),

  placement(
    auditAction: PlacementAction,
    placementLocationId: LocationId,
  ): AuditContext.Placement {
    return { auditAction, placementLocationId };
  },
  /** The delta's id lists are carried as given — read-only, never copied (Law 3; no allocation). */
  staffEdit(
    auditAction: StaffEditAction,
    editRevision: number,
    delta: StaffEditDelta,
  ): AuditContext.StaffEdit {
    return {
      auditAction,
      editRevision,
      editRepriceFromCents: delta.editRepriceFromCents,
      editRepriceToCents: delta.editRepriceToCents,
      editCurrency: delta.editCurrency,
      editDiscountFromIds: delta.editDiscountFromIds,
      editDiscountIds: delta.editDiscountIds,
      editVoucherDebitCents: delta.editVoucherDebitCents,
      editDurationFromMinutes: delta.editDurationFromMinutes,
      editDurationToMinutes: delta.editDurationToMinutes,
      editRelocateFromLocationId: delta.editRelocateFromLocationId,
      editRelocateToLocationId: delta.editRelocateToLocationId,
      editMoveFromLocalDate: delta.editMoveFromLocalDate,
      editMoveToLocalDate: delta.editMoveToLocalDate,
      editMoveFromStartMinutes: delta.editMoveFromStartMinutes,
      editMoveToStartMinutes: delta.editMoveToStartMinutes,
      editRestaffFromBarberIds: delta.editRestaffFromBarberIds,
      editRestaffToBarberIds: delta.editRestaffToBarberIds,
    };
  },
  /** The delta's barber lists are carried as given — read-only, never copied (Law 3; no allocation). */
  rescheduled(
    rescheduleRevision: number,
    delta: RescheduleDelta,
  ): AuditContext.Rescheduled {
    return {
      auditAction: AuditAction.BookingRescheduled,
      rescheduleRevision,
      rescheduleFromLocalDate: delta.rescheduleFromLocalDate,
      rescheduleToLocalDate: delta.rescheduleToLocalDate,
      rescheduleFromStartMinutes: delta.rescheduleFromStartMinutes,
      rescheduleToStartMinutes: delta.rescheduleToStartMinutes,
      rescheduleFromBarberIds: delta.rescheduleFromBarberIds,
      rescheduleToBarberIds: delta.rescheduleToBarberIds,
      rescheduleFromLocationId: delta.rescheduleFromLocationId,
      rescheduleToLocationId: delta.rescheduleToLocationId,
    };
  },
  cancelled(
    cancellationReason: CancellationReason,
    delta: CancellationDelta,
  ): AuditContext.Cancelled {
    return {
      auditAction: AuditAction.BookingCancelled,
      cancellationReason,
      cancellationFromBookingStatus: delta.cancellationFromBookingStatus,
      cancellationFromStatusAtUtcMs: delta.cancellationFromStatusAtUtcMs,
    };
  },
  transition(
    auditAction: TransitionAction,
    transitionReason: CancellationReason | null,
    transitionSeatId: SeatId | null,
    delta: TransitionDelta,
  ): AuditContext.Transition {
    return {
      auditAction,
      transitionReason,
      transitionSeatId,
      transitionFromBookingStatus: delta.transitionFromBookingStatus,
      transitionFromStatusAtUtcMs: delta.transitionFromStatusAtUtcMs,
      transitionFromAttendanceState: delta.transitionFromAttendanceState,
    };
  },
  arrival(auditAction: ArrivalAction): AuditContext.Arrival {
    return { auditAction };
  },
  tip(
    auditAction: TipAction,
    tipSeatId: SeatId,
    delta: TipDelta,
  ): AuditContext.Tip {
    return {
      auditAction,
      tipSeatId,
      tipAmountCents: delta.tipAmountCents,
      tipFromCents: delta.tipFromCents,
      tipCurrency: delta.tipCurrency,
    };
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
      streakChanged: facts.streakChanged,
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
  /**
   * A profile row that names no role or status change — the four tag pairs
   * `null` (an owner's own edit never touches `roles` or `accountStatus`).
   * The field list is carried as given.
   */
  profile(
    auditAction: ProfileAction,
    profileFields: readonly AuditedProfileField[],
  ): AuditContext.Profile {
    return AuditContext.profileWithTags(auditAction, profileFields, NO_TAGS);
  },
  /**
   * A profile row with its role / status before-and-after (audit-hardening
   * WS-3: each pair set iff its field changed — `AuditSystem.profileTagDelta`).
   * The lists are carried as given — read-only, never copied (Law 3; no
   * allocation).
   */
  profileWithTags(
    auditAction: ProfileAction,
    profileFields: readonly AuditedProfileField[],
    tags: Omit<AuditContext.Profile, 'auditAction' | 'profileFields'>,
  ): AuditContext.Profile {
    return {
      auditAction,
      profileFields,
      profileRolesFrom: tags.profileRolesFrom,
      profileRolesTo: tags.profileRolesTo,
      profileAccountStatusFrom: tags.profileAccountStatusFrom,
      profileAccountStatusTo: tags.profileAccountStatusTo,
    };
  },
  /** An impersonation session opened (audit-hardening WS-3): ids, the scope and the window's end. */
  impersonationStarted(
    impersonationSessionId: ImpersonationSessionId,
    impersonationScope: ImpersonationScope,
    impersonationExpiresAtUtcMs: UtcEpochMs,
  ): AuditContext.ImpersonationStarted {
    return {
      auditAction: AuditAction.GovernanceImpersonationStarted,
      impersonationSessionId,
      impersonationScope,
      impersonationExpiresAtUtcMs,
    };
  },
  /** An impersonation session ended, and why (RU-14: the planner writes ADMIN_ENDED / EXPIRED only). */
  impersonationEnded(
    impersonationSessionId: ImpersonationSessionId,
    impersonationScope: ImpersonationScope,
    impersonationExpiresAtUtcMs: UtcEpochMs,
    impersonationEndReason: ImpersonationEndReason,
  ): AuditContext.ImpersonationEnded {
    return {
      auditAction: AuditAction.GovernanceImpersonationEnded,
      impersonationSessionId,
      impersonationScope,
      impersonationExpiresAtUtcMs,
      impersonationEndReason,
    };
  },
  /** A governed document write; the field-name list is carried as given. */
  governed(
    auditAction: GovernedAction,
    governedCollection: GovernedCollection,
    governedFields: readonly string[],
  ): AuditContext.Governed {
    return {
      auditAction,
      governedCollection,
      governedFields,
    };
  },
  /**
   * A challenge saved (Phase 3 WS-B): its channel, purpose and expiry —
   * never the destination, the code, its hash or its salt (R36 / T5).
   */
  otpRequested(
    otpDestinationType: OtpDestinationType,
    otpPurpose: OtpPurpose,
    otpExpiresAtUtcMs: UtcEpochMs,
  ): AuditContext.OtpRequested {
    return {
      auditAction: AuditAction.IdentityOtpRequested,
      otpDestinationType,
      otpPurpose,
      otpExpiresAtUtcMs,
    };
  },
  /** A challenge consumed: its channel, purpose and the wrong codes before the right one. */
  otpVerified(
    otpDestinationType: OtpDestinationType,
    otpPurpose: OtpPurpose,
    otpAttemptCount: number,
  ): AuditContext.OtpVerified {
    return {
      auditAction: AuditAction.IdentityOtpVerified,
      otpDestinationType,
      otpPurpose,
      otpAttemptCount,
    };
  },
  /** A wrong code recorded: why, and the attempt count after it against the limit. */
  otpRefused(
    otpDestinationType: OtpDestinationType,
    otpPurpose: OtpPurpose,
    otpRefusalReason: OtpRefusalReason,
    otpAttemptCount: number,
    otpMaxAttempts: number,
  ): AuditContext.OtpRefused {
    return {
      auditAction: AuditAction.IdentityOtpRefused,
      otpDestinationType,
      otpPurpose,
      otpRefusalReason,
      otpAttemptCount,
      otpMaxAttempts,
    };
  },
  /** A sign-in token answered: whether the person was new, and over which channel. */
  sessionIssued(
    sessionKind: SessionKind,
    otpDestinationType: OtpDestinationType,
  ): AuditContext.SessionIssued {
    return {
      auditAction: AuditAction.IdentitySessionIssued,
      sessionKind,
      otpDestinationType,
    };
  },
  /** An account's first registration completed, and the channel it signed in with. */
  registrationCompleted(
    registrationIdentifierChannel: IdentifierChannel,
  ): AuditContext.RegistrationCompleted {
    return {
      auditAction: AuditAction.IdentityRegistrationCompleted,
      registrationIdentifierChannel,
    };
  },
  /**
   * A client's data exported (Phase 3 WS-C): how many documents, audit rows
   * and bytes the bundle held — never the bundle, a section or a value.
   */
  clientExported(
    exportDocumentCount: number,
    exportAuditRowCount: number,
    exportByteCount: number,
  ): AuditContext.ClientExported {
    return {
      auditAction: AuditAction.PrivacyClientExported,
      exportDocumentCount,
      exportAuditRowCount,
      exportByteCount,
    };
  },
  /**
   * An erasure row (Phase 3 WS-D, P3-RU-22): the verb and exactly the
   * eleven census counts ({@link ErasureCensus.countsOf} — a wider struct's
   * other fields never reach the row) — never a value of the person.
   */
  clientErasure(
    auditAction: ErasureAction,
    census: ErasureCensus,
  ): AuditContext.ClientErasure {
    return { auditAction, ...ErasureCensus.countsOf(census) };
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
  /**
   * A staff edit; `editRevision` is the one the save stamped, and the
   * {@link StaffEditDelta} what it changed (each pair `null` when untouched).
   */
  export type StaffEdit = {
    readonly auditAction: StaffEditAction;
    readonly editRevision: number;
  } & StaffEditDelta;
  /**
   * A move, the revision it stamped and where it took the visit
   * ({@link RescheduleDelta}). A replay writes no row (WS-1: the row commits
   * with the move, so a replay has nothing left to log).
   */
  export type Rescheduled = {
    readonly auditAction: typeof AuditAction.BookingRescheduled;
    readonly rescheduleRevision: number;
  } & RescheduleDelta;
  /**
   * A client cancellation; `cancellationReason` is the cancellation reason
   * CODE, and the {@link CancellationDelta} the state it left.
   */
  export type Cancelled = {
    readonly auditAction: typeof AuditAction.BookingCancelled;
    readonly cancellationReason: CancellationReason;
  } & CancellationDelta;
  /**
   * A staff lifecycle verb; the reason for a cancel, the seat for a per-seat
   * act, and the {@link TransitionDelta} the state it left.
   */
  export type Transition = {
    readonly auditAction: TransitionAction;
    readonly transitionReason: CancellationReason | null;
    readonly transitionSeatId: SeatId | null;
  } & TransitionDelta;
  /** Arrival stamped or cleared — the verb is the whole fact. */
  export type Arrival = {
    readonly auditAction: ArrivalAction;
  };
  /**
   * A tip recorded or cleared on one seat — the act AND the amount, before
   * and after, in the seat's currency ({@link TipDelta}).
   */
  export type Tip = {
    readonly auditAction: TipAction;
    readonly tipSeatId: SeatId;
  } & TipDelta;
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
  /**
   * A `users/{uid}` write; `profileFields` are the changed field names. The
   * role and status tags are the one before-and-after a profile row carries
   * (closed vocabularies, never a typed value — R36): each pair is set iff
   * its field changed (`roles` as the known roles of each side, a side's
   * unknown status `null`), else both `null`.
   */
  export type Profile = {
    readonly auditAction: ProfileAction;
    readonly profileFields: readonly AuditedProfileField[];
    readonly profileRolesFrom: readonly Role[] | null;
    readonly profileRolesTo: readonly Role[] | null;
    readonly profileAccountStatusFrom: AccountStatus | null;
    readonly profileAccountStatusTo: AccountStatus | null;
  };
  /**
   * An admin opened an impersonation session (audit-hardening WS-3). Ids,
   * the scope and the window's end only — never the session's `reason`
   * (free text, T5 / R36). The row is never TTL'd, unlike the session.
   */
  export type ImpersonationStarted = {
    readonly auditAction: typeof AuditAction.GovernanceImpersonationStarted;
    readonly impersonationSessionId: ImpersonationSessionId;
    readonly impersonationScope: ImpersonationScope;
    readonly impersonationExpiresAtUtcMs: UtcEpochMs;
  };
  /**
   * An impersonation session ended — the start's facts and the end reason
   * (typed by the whole dictionary; only `ADMIN_ENDED` / `EXPIRED` are ever
   * written, RU-14). Never `revocationNotes` (free text).
   */
  export type ImpersonationEnded = {
    readonly auditAction: typeof AuditAction.GovernanceImpersonationEnded;
    readonly impersonationSessionId: ImpersonationSessionId;
    readonly impersonationScope: ImpersonationScope;
    readonly impersonationExpiresAtUtcMs: UtcEpochMs;
    readonly impersonationEndReason: ImpersonationEndReason;
  };
  /**
   * A governed document's write (audit-hardening WS-3, RU-40): which
   * collection (never USERS on a row — a users write is a `PROFILE_*` row)
   * and which top-level fields changed.
   */
  export type Governed = {
    readonly auditAction: GovernedAction;
    readonly governedCollection: GovernedCollection;
    /** Changed top-level field NAMES, ascending, deduplicated — never a value (R36). */
    readonly governedFields: readonly string[];
  };
  /*
   * The sign-in rows (audit-hardening Phase 3 WS-B, P3-DEP-7): tags, counts
   * and the expiry only — never the destination (a phone or an e-mail), the
   * code, its hash or salt, a name or any free text (R36 / T5). A field
   * several of these variants share (`otpDestinationType`, `otpPurpose`,
   * `otpAttemptCount`) is legal: the union is discriminated by
   * `auditAction` alone, and each field is disjoint from the actor, target
   * and meta slices (`identity-entities.type-spec.ts`).
   */
  /** A challenge saved — the resource is `otps/<id>`, the target none (no account resolved yet). */
  export type OtpRequested = {
    readonly auditAction: typeof AuditAction.IdentityOtpRequested;
    readonly otpDestinationType: OtpDestinationType;
    readonly otpPurpose: OtpPurpose;
    readonly otpExpiresAtUtcMs: UtcEpochMs;
  };
  /** A challenge consumed; `otpAttemptCount` is the wrong codes recorded before this success. */
  export type OtpVerified = {
    readonly auditAction: typeof AuditAction.IdentityOtpVerified;
    readonly otpDestinationType: OtpDestinationType;
    readonly otpPurpose: OtpPurpose;
    readonly otpAttemptCount: number;
  };
  /**
   * A wrong code recorded against a challenge; `otpAttemptCount` is the
   * count AFTER this attempt, `otpMaxAttempts` the challenge's limit
   * (`LOCKED_OUT` when the first reaches the second).
   */
  export type OtpRefused = {
    readonly auditAction: typeof AuditAction.IdentityOtpRefused;
    readonly otpDestinationType: OtpDestinationType;
    readonly otpPurpose: OtpPurpose;
    readonly otpRefusalReason: OtpRefusalReason;
    readonly otpAttemptCount: number;
    readonly otpMaxAttempts: number;
  };
  /** A sign-in token answered — on the account's own timeline (`users/<uid>`). */
  export type SessionIssued = {
    readonly auditAction: typeof AuditAction.IdentitySessionIssued;
    readonly sessionKind: SessionKind;
    readonly otpDestinationType: OtpDestinationType;
  };
  /** An account's first registration completed, credited to the verified caller. */
  export type RegistrationCompleted = {
    readonly auditAction: typeof AuditAction.IdentityRegistrationCompleted;
    readonly registrationIdentifierChannel: IdentifierChannel;
  };
  /**
   * An admin's data-subject export (audit-hardening Phase 3 WS-C, P3-RU-15):
   * the resource is `customers/<id>`, the target the client record, the
   * actor the admin. Counts only — never the bundle, a section or any value
   * of the person (R36 / T5); the row is never inside its own bundle.
   */
  export type ClientExported = {
    readonly auditAction: typeof AuditAction.PrivacyClientExported;
    /** The documents in the bundle, its audit rows included. */
    readonly exportDocumentCount: number;
    /** Of those, the audit rows that target the person. */
    readonly exportAuditRowCount: number;
    /** The UTF-8 bytes of the bundle's canonical JSON. */
    readonly exportByteCount: number;
  };
  /**
   * An admin's data-subject erasure (audit-hardening Phase 3 WS-D, P3-RU-22)
   * — the resource is `customers/<id>`, the target the client record, the
   * actor the admin. The verb says which census the row carries: SWEPT the
   * census BEFORE of the act whose pre-stamp contact sweep it accounts for
   * (P3-DEP-33), STARTED
   * the census BEFORE (what will be erased), ERASED the residue AFTER (every
   * personal count 0, beside what was retained), RESWEPT the census BEFORE a
   * sweep of an erased record that found residue (P3-L-19). Counts only
   * ({@link ErasureCensus}) — never a name, a contact value, a label, free
   * text or a sibling record's id (R36 / T5).
   */
  export type ClientErasure = {
    readonly auditAction: ErasureAction;
  } & ErasureCensus;
}
