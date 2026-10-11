import { describe, expect, it } from 'vitest';
import { BackfillJobName } from '../entities/backfill-job.entity';
import {
  CustomerId,
  LocationId,
  SeatId,
  UserId,
} from '../primitives/ids.primitive';
import { localDate } from '../testing';
import {
  ARRIVAL_ACTIONS,
  AUDIT_ACTIONS,
  AuditAction,
  AuditContext,
  AuditTarget,
  AuditTargetRef,
  BackfillOutcome,
  PLACEMENT_ACTIONS,
  PROFILE_ACTIONS,
  STAFF_EDIT_ACTIONS,
  TIP_ACTIONS,
  TRANSITION_ACTIONS,
} from './audit-context.data';
import {
  StreakRuleDirection,
  StreakRuleParameter,
  StreakTransition,
} from './streak-rule.data';

describe('AuditAction', () => {
  it('keeps every audited verb, SCREAMING_SNAKE and domain-prefixed, each once', () => {
    expect(new Set(AUDIT_ACTIONS).size).toBe(AUDIT_ACTIONS.length);
    for (const action of AUDIT_ACTIONS) {
      expect(action).toMatch(/^(BOOKING|LOYALTY|OPS|PROFILE)_[A-Z_]+$/);
    }
    // Spot-check the upper-snaked spelling of today's stored strings.
    expect(AuditAction.BookingStaffAddSeat).toBe('BOOKING_STAFF_ADD_SEAT');
    expect(AuditAction.BookingStaffReinstate).toBe('BOOKING_STAFF_REINSTATE');
    expect(AuditAction.OpsBackfill).toBe('OPS_BACKFILL');
  });

  it('every grouped verb is in the dictionary, and no verb is in two groups', () => {
    const groups = [
      PLACEMENT_ACTIONS,
      TRANSITION_ACTIONS,
      ARRIVAL_ACTIONS,
      TIP_ACTIONS,
      STAFF_EDIT_ACTIONS,
      PROFILE_ACTIONS,
    ];
    const seen = new Set<string>();
    for (const group of groups) {
      for (const action of group) {
        expect(AUDIT_ACTIONS).toContain(action);
        expect(seen.has(action)).toBe(false);
        seen.add(action);
      }
    }
  });

  it('the groups plus the single-verb variants partition the dictionary — no list drops a verb', () => {
    const singles: readonly AuditAction[] = [
      AuditAction.BookingRescheduled,
      AuditAction.BookingCancelled,
      AuditAction.LoyaltyStreakDefinitionPublished,
      AuditAction.LoyaltyStreakDefinitionWithdrawn,
      AuditAction.OpsBackfill,
    ];
    const covered: AuditAction[] = [
      ...PLACEMENT_ACTIONS,
      ...TRANSITION_ACTIONS,
      ...ARRIVAL_ACTIONS,
      ...TIP_ACTIONS,
      ...STAFF_EDIT_ACTIONS,
      ...PROFILE_ACTIONS,
      ...singles,
    ];
    expect([...covered].sort()).toEqual([...AUDIT_ACTIONS].sort());
  });

  it('isAuditAction narrows known verbs and rejects strangers', () => {
    expect(AuditContext.isAuditAction('BOOKING_CANCELLED')).toBe(true);
    // The stored dotted spelling is not a verb of the dictionary — shims convert.
    expect(AuditContext.isAuditAction('booking.cancelled')).toBe(false);
    expect(AuditContext.isAuditAction('register_user')).toBe(false);
    expect(AuditContext.isAuditAction(undefined)).toBe(false);
  });
});

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
    expect(AuditContext.staffEdit(AuditAction.BookingStaffMove, 7)).toEqual({
      auditAction: 'BOOKING_STAFF_MOVE',
      editRevision: 7,
    });
    expect(AuditContext.rescheduled(3, true)).toEqual({
      auditAction: 'BOOKING_RESCHEDULED',
      rescheduleRevision: 3,
      loggedOnRetry: true,
    });
    expect(AuditContext.cancelled('schedule_conflict')).toEqual({
      auditAction: 'BOOKING_CANCELLED',
      cancellationReason: 'schedule_conflict',
    });
  });

  it('transition / arrival / tip', () => {
    expect(
      AuditContext.transition(
        AuditAction.BookingStaffNoShow,
        null,
        SeatId.of('s-1'),
      ),
    ).toEqual({
      auditAction: 'BOOKING_STAFF_NO_SHOW',
      transitionReason: null,
      transitionSeatId: 's-1',
    });
    expect(AuditContext.arrival(AuditAction.BookingStaffArrived)).toEqual({
      auditAction: 'BOOKING_STAFF_ARRIVED',
    });
    expect(
      AuditContext.tip(AuditAction.BookingTipCleared, SeatId.of('s-2')),
    ).toEqual({
      auditAction: 'BOOKING_TIP_CLEARED',
      tipSeatId: 's-2',
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

  it('profile copies the changed field names', () => {
    const fields = ['firstName'];
    const context = AuditContext.profile(AuditAction.ProfileUpdated, fields);
    fields.push('phone');
    expect(context).toEqual({
      auditAction: 'PROFILE_UPDATED',
      profileFields: ['firstName'],
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
