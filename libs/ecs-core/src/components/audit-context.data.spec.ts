import { describe, expect, it } from 'vitest';
import { BackfillJobName } from './backfill-job-name.data';
import {
  AppliedDiscountId,
  AttendanceState,
  BarberId,
  BookingStatus,
  Currency,
  CustomerId,
  ImpersonationSessionId,
  LocationId,
  PriceCents,
  SeatId,
  UserId,
} from '@core/primitives';
import { localDate, minute, unwrapOk, utcMs } from '@core/testing';
import type { ArrivalAction } from './arrival-action.data';
import {
  AuditAction,
  AuditContext,
  BackfillOutcome,
} from './audit-context.data';
import { AuditTarget, AuditTargetRef } from './audit-target-ref.data';
import { CancellationReason } from './cancellation-reason.data';
import type { PlacementAction } from './placement-action.data';
import type { ProfileAction } from './profile-action.data';
import { AccountStatus } from './account-status.data';
import { AuditedProfileField } from './audited-profile-field.data';
import { ImpersonationEndReason } from './end-reason-fields.data';
import type { GovernedAction } from './governed-action.data';
import { GovernedCollection } from './governed-collection.data';
import { ImpersonationScope } from './impersonation-scope.data';
import { RegistrationField } from './registration.data';
import { Role } from './role.data';
import type { RescheduleDelta } from './reschedule-delta.data';
import { StaffEditDelta } from './staff-edit-delta.data';
import type { StaffEditAction } from './staff-edit-action.data';
import type { TipAction } from './tip-action.data';
import type { TransitionAction } from './transition-action.data';
import { StreakRuleDirection } from './streak-rule-direction.data';
import { StreakRuleParameter } from './streak-rule-parameter.data';
import { StreakTransition } from './streak-transition.data';

/** `true` when no group shares a verb with any group before it. */
type Apart<G extends readonly unknown[], Seen = never> = G extends readonly [
  infer Head,
  ...infer Rest,
]
  ? [Extract<Head, Seen>] extends [never]
    ? Apart<Rest, Seen | Head>
    : false
  : true;

describe('AuditAction', () => {
  it('keeps every audited verb, SCREAMING_SNAKE and domain-prefixed, each once', () => {
    expect(new Set(AuditContext.ACTIONS).size).toBe(
      AuditContext.ACTIONS.length,
    );
    for (const action of AuditContext.ACTIONS) {
      expect(action).toMatch(
        /^(BOOKING|LOYALTY|OPS|PROFILE|GOVERNANCE|GOVERNED)_[A-Z_]+$/,
      );
    }
    // Spot-check the upper-snaked spelling of today's stored strings.
    expect(AuditAction.BookingStaffAddSeat).toBe('BOOKING_STAFF_ADD_SEAT');
    expect(AuditAction.BookingStaffReinstate).toBe('BOOKING_STAFF_REINSTATE');
    expect(AuditAction.OpsBackfill).toBe('OPS_BACKFILL');
    // The audit-hardening WS-3 verbs (DEP-17) — no REVOKED verb.
    expect(AuditAction.GovernanceImpersonationStarted).toBe(
      'GOVERNANCE_IMPERSONATION_STARTED',
    );
    expect(AuditAction.GovernanceImpersonationEnded).toBe(
      'GOVERNANCE_IMPERSONATION_ENDED',
    );
    expect(AuditAction.GovernedDocCreated).toBe('GOVERNED_DOC_CREATED');
    expect(AuditAction.GovernedDocUpdated).toBe('GOVERNED_DOC_UPDATED');
    expect(AuditAction.GovernedDocDeleted).toBe('GOVERNED_DOC_DELETED');
    expect(
      AuditContext.ACTIONS.filter((action) => action.includes('REVOKE')),
    ).toEqual([]);
  });

  it('the verb groups plus the single-verb variants partition the dictionary — each verb in exactly one (tsc)', () => {
    type Singles =
      | typeof AuditAction.BookingRescheduled
      | typeof AuditAction.BookingCancelled
      | typeof AuditAction.LoyaltyStreakDefinitionPublished
      | typeof AuditAction.LoyaltyStreakDefinitionWithdrawn
      | typeof AuditAction.OpsBackfill
      | typeof AuditAction.GovernanceImpersonationStarted
      | typeof AuditAction.GovernanceImpersonationEnded;
    type Groups = [
      PlacementAction,
      TransitionAction,
      ArrivalAction,
      TipAction,
      StaffEditAction,
      ProfileAction,
      GovernedAction,
      Singles,
    ];
    // `tsc` failing on either constant IS the failure.
    const apart: Apart<Groups> = true;
    const covers: [Exclude<AuditAction, Groups[number]>] extends [never]
      ? true
      : false = true;
    expect([apart, covers]).toEqual([true, true]);
  });

  it('isAuditAction narrows known verbs and rejects strangers', () => {
    expect(AuditContext.isAuditAction('BOOKING_CANCELLED')).toBe(true);
    // The legacy dotted spelling is not a verb of the dictionary — no shim
    // converts it.
    expect(AuditContext.isAuditAction('booking.cancelled')).toBe(false);
    expect(AuditContext.isAuditAction('register_user')).toBe(false);
    expect(AuditContext.isAuditAction(undefined)).toBe(false);
  });
});

const AT = utcMs('2026-09-25T08:00:00Z');
/** A move across two days, two shops, a re-staffed first seat. */
const MOVE: RescheduleDelta = {
  rescheduleFromLocalDate: localDate('2026-10-01'),
  rescheduleToLocalDate: localDate('2026-10-02'),
  rescheduleFromStartMinutes: minute(600),
  rescheduleToStartMinutes: minute(660),
  rescheduleFromBarberIds: [BarberId.of('b-1'), BarberId.of('b-1')],
  rescheduleToBarberIds: [BarberId.of('b-2'), BarberId.of('b-1')],
  rescheduleFromLocationId: LocationId.of('loc-1'),
  rescheduleToLocationId: LocationId.of('loc-2'),
};

describe('AuditContext — one flat variant per verb family, every field present', () => {
  it('placement / staff edit / reschedule / cancel', () => {
    expect(
      AuditContext.placement(
        AuditAction.BookingCommitted,
        LocationId.of('loc-1'),
      ),
    ).toEqual({
      auditAction: 'BOOKING_COMMITTED',
      placementLocationId: 'loc-1',
    });
    // A save that touched nothing audited: every delta pair null.
    expect(
      AuditContext.staffEdit(
        AuditAction.BookingStaffMove,
        7,
        StaffEditDelta.NONE,
      ),
    ).toEqual({
      auditAction: 'BOOKING_STAFF_MOVE',
      editRevision: 7,
      editRepriceFromCents: null,
      editRepriceToCents: null,
      editCurrency: null,
      editDiscountFromIds: null,
      editDiscountIds: null,
      editVoucherDebitCents: null,
      editDurationFromMinutes: null,
      editDurationToMinutes: null,
      editRelocateFromLocationId: null,
      editRelocateToLocationId: null,
      editMoveFromLocalDate: null,
      editMoveToLocalDate: null,
      editMoveFromStartMinutes: null,
      editMoveToStartMinutes: null,
      editRestaffFromBarberIds: null,
      editRestaffToBarberIds: null,
    });
    expect(AuditContext.rescheduled(3, MOVE)).toEqual({
      auditAction: 'BOOKING_RESCHEDULED',
      rescheduleRevision: 3,
      rescheduleFromLocalDate: '2026-10-01',
      rescheduleToLocalDate: '2026-10-02',
      rescheduleFromStartMinutes: 600,
      rescheduleToStartMinutes: 660,
      rescheduleFromBarberIds: ['b-1', 'b-1'],
      rescheduleToBarberIds: ['b-2', 'b-1'],
      rescheduleFromLocationId: 'loc-1',
      rescheduleToLocationId: 'loc-2',
    });
    expect(
      AuditContext.cancelled(CancellationReason.ClientChangedPlans, {
        cancellationFromBookingStatus: BookingStatus.Confirmed,
        cancellationFromStatusAtUtcMs: AT,
      }),
    ).toEqual({
      auditAction: 'BOOKING_CANCELLED',
      cancellationReason: 'CLIENT_CHANGED_PLANS',
      cancellationFromBookingStatus: 'CONFIRMED',
      cancellationFromStatusAtUtcMs: AT,
    });
  });

  it('staff edit carries a touched pair and copies its id lists', () => {
    const discountIds = [AppliedDiscountId.of('manual')];
    const barbers = [BarberId.of('b-1')];
    const context = AuditContext.staffEdit(AuditAction.BookingStaffSave, 4, {
      ...StaffEditDelta.NONE,
      editDiscountFromIds: [],
      editDiscountIds: discountIds,
      editRestaffFromBarberIds: barbers,
      editRestaffToBarberIds: [BarberId.of('b-2')],
    });
    discountIds.push(AppliedDiscountId.of('code:c-1'));
    barbers.push(BarberId.of('b-9'));
    expect(context).toMatchObject({
      editDiscountFromIds: [],
      editDiscountIds: ['manual'],
      editRestaffFromBarberIds: ['b-1'],
      editRestaffToBarberIds: ['b-2'],
      editCurrency: null,
    });
  });

  it('reschedule copies its barber lists', () => {
    const from = [BarberId.of('b-1')];
    const context = AuditContext.rescheduled(1, {
      ...MOVE,
      rescheduleFromBarberIds: from,
    });
    from.push(BarberId.of('b-9'));
    expect(context.rescheduleFromBarberIds).toEqual(['b-1']);
  });

  it('transition / arrival / tip', () => {
    expect(
      AuditContext.transition(
        AuditAction.BookingStaffNoShow,
        null,
        SeatId.of('s-1'),
        {
          transitionFromBookingStatus: BookingStatus.Confirmed,
          transitionFromStatusAtUtcMs: AT,
          transitionFromAttendanceState: AttendanceState.Scheduled,
        },
      ),
    ).toEqual({
      auditAction: 'BOOKING_STAFF_NO_SHOW',
      transitionReason: null,
      transitionSeatId: 's-1',
      transitionFromBookingStatus: 'CONFIRMED',
      transitionFromStatusAtUtcMs: AT,
      transitionFromAttendanceState: 'SCHEDULED',
    });
    expect(AuditContext.arrival(AuditAction.BookingStaffArrived)).toEqual({
      auditAction: 'BOOKING_STAFF_ARRIVED',
    });
    expect(
      AuditContext.tip(AuditAction.BookingTipCleared, SeatId.of('s-2'), {
        tipAmountCents: null,
        tipFromCents: unwrapOk(PriceCents.of(500)),
        tipCurrency: Currency.EUR,
      }),
    ).toEqual({
      auditAction: 'BOOKING_TIP_CLEARED',
      tipSeatId: 's-2',
      tipAmountCents: null,
      tipFromCents: 500,
      tipCurrency: 'EUR',
    });
  });

  it('streak published / withdrawn copy their facts', () => {
    const streakChanged: StreakRuleParameter[] = [StreakRuleParameter.Interval];
    const published = AuditContext.streakPublished({
      streakFromVersion: 1,
      streakToVersion: 2,
      streakEffectiveFrom: localDate('2026-11-01'),
      streakTransition: StreakTransition.Grandfather,
      streakRuleDirection: StreakRuleDirection.Stricter,
      streakChanged,
      streakReplacedVersion: null,
    });
    streakChanged.push(StreakRuleParameter.Qualifier);
    expect(published).toEqual({
      auditAction: 'LOYALTY_STREAK_DEFINITION_PUBLISHED',
      streakFromVersion: 1,
      streakToVersion: 2,
      streakEffectiveFrom: '2026-11-01',
      streakTransition: 'GRANDFATHER',
      streakRuleDirection: 'STRICTER',
      streakChanged: ['INTERVAL'],
      streakReplacedVersion: null,
    });
    expect(
      AuditContext.streakWithdrawn({
        streakFromVersion: 2,
        streakToVersion: 1,
        streakEffectiveFrom: localDate('2026-11-01'),
        streakTransition: StreakTransition.Grandfather,
      }),
    ).toEqual({
      auditAction: 'LOYALTY_STREAK_DEFINITION_WITHDRAWN',
      streakFromVersion: 2,
      streakToVersion: 1,
      streakEffectiveFrom: '2026-11-01',
      streakTransition: 'GRANDFATHER',
    });
  });

  it('backfill keeps every page figure, null when the call threw', () => {
    expect(
      AuditContext.backfill({
        backfillJobName: BackfillJobName.ClientStats,
        backfillOutcome: BackfillOutcome.Failed,
        backfillFailureCode: 'deadline-exceeded',
        backfillProcessed: null,
        backfillStoredClients: null,
        backfillDone: null,
        backfillBudgetSpent: null,
        backfillCursor: null,
      }),
    ).toEqual({
      auditAction: 'OPS_BACKFILL',
      backfillJobName: 'CLIENT_STATS',
      backfillOutcome: 'FAILED',
      backfillFailureCode: 'deadline-exceeded',
      backfillProcessed: null,
      backfillStoredClients: null,
      backfillDone: null,
      backfillBudgetSpent: null,
      backfillCursor: null,
    });
  });

  it('profile copies the changed field names; its role and status tags stay null', () => {
    const fields: RegistrationField[] = [RegistrationField.FirstName];
    const context = AuditContext.profile(AuditAction.ProfileUpdated, fields);
    fields.push(RegistrationField.Phone);
    expect(context).toEqual({
      auditAction: 'PROFILE_UPDATED',
      profileFields: ['firstName'],
      profileRolesFrom: null,
      profileRolesTo: null,
      profileAccountStatusFrom: null,
      profileAccountStatusTo: null,
    });
  });

  it('profileWithTags carries the role and status before-and-after, the lists copied (WS-3)', () => {
    const rolesTo: Role[] = [Role.Barber];
    const context = AuditContext.profileWithTags(
      AuditAction.ProfileUpdated,
      [AuditedProfileField.Roles, AuditedProfileField.AccountStatus],
      {
        profileRolesFrom: [],
        profileRolesTo: rolesTo,
        profileAccountStatusFrom: AccountStatus.Active,
        profileAccountStatusTo: AccountStatus.Blocked,
      },
    );
    rolesTo.push(Role.Admin);
    expect(context).toEqual({
      auditAction: 'PROFILE_UPDATED',
      profileFields: ['roles', 'accountStatus'],
      profileRolesFrom: [],
      profileRolesTo: ['barber'],
      profileAccountStatusFrom: 'ACTIVE',
      profileAccountStatusTo: 'BLOCKED',
    });
  });

  it('impersonation started / ended — ids, the scope, the window and the end reason only (WS-3)', () => {
    const id = ImpersonationSessionId.of('imp-1');
    expect(
      AuditContext.impersonationStarted(id, ImpersonationScope.Read, AT),
    ).toEqual({
      auditAction: 'GOVERNANCE_IMPERSONATION_STARTED',
      impersonationSessionId: 'imp-1',
      impersonationScope: 'READ',
      impersonationExpiresAtUtcMs: AT,
    });
    expect(
      AuditContext.impersonationEnded(
        id,
        ImpersonationScope.Write,
        AT,
        ImpersonationEndReason.Expired,
      ),
    ).toEqual({
      auditAction: 'GOVERNANCE_IMPERSONATION_ENDED',
      impersonationSessionId: 'imp-1',
      impersonationScope: 'WRITE',
      impersonationExpiresAtUtcMs: AT,
      impersonationEndReason: 'EXPIRED',
    });
  });

  it('governed copies the changed field names (WS-3)', () => {
    const fields = ['dayOfWeek', 'closed'];
    const context = AuditContext.governed(
      AuditAction.GovernedDocUpdated,
      GovernedCollection.BarberSchedules,
      fields,
    );
    fields.push('notes');
    expect(context).toEqual({
      auditAction: 'GOVERNED_DOC_UPDATED',
      governedCollection: 'BARBER_SCHEDULES',
      governedFields: ['dayOfWeek', 'closed'],
    });
  });
});

describe('AuditTargetRef — whom an act touched (D29)', () => {
  it('NONE is a shared singleton; USER and CUSTOMER carry their own id', () => {
    expect(AuditTargetRef.none()).toEqual({ auditTarget: 'NONE' });
    expect(AuditTargetRef.none()).toBe(AuditTargetRef.none());
    expect(AuditTargetRef.user(UserId.of('u-1'))).toEqual({
      auditTarget: AuditTarget.User,
      targetUserId: 'u-1',
    });
    expect(AuditTargetRef.customer(CustomerId.of('cus_1'))).toEqual({
      auditTarget: AuditTarget.Customer,
      targetCustomerId: 'cus_1',
    });
  });

  it('forUser derives the slice from a nullable account — NONE for null, USER otherwise', () => {
    expect(AuditTargetRef.forUser(null)).toBe(AuditTargetRef.none());
    expect(AuditTargetRef.forUser(UserId.of('u-1'))).toEqual(
      AuditTargetRef.user(UserId.of('u-1')),
    );
  });

  it('targetUserIdOf reads an account target only — never a customer as a user', () => {
    expect(AuditTargetRef.targetUserIdOf(AuditTargetRef.none())).toBeNull();
    expect(
      AuditTargetRef.targetUserIdOf(AuditTargetRef.user(UserId.of('u-1'))),
    ).toBe('u-1');
    expect(
      AuditTargetRef.targetUserIdOf(
        AuditTargetRef.customer(CustomerId.of('cus_1')),
      ),
    ).toBeNull();
  });
});
