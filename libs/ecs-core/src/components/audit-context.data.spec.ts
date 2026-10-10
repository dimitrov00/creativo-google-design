import { describe, expect, it } from 'vitest';
import { BackfillJobKind } from '../entities/backfill-job.entity';
import { LocationId } from '../entities/location.entity';
import {
  ARRIVAL_ACTIONS,
  AUDIT_ACTIONS,
  AuditAction,
  AuditContext,
  BackfillOutcome,
  PLACEMENT_ACTIONS,
  PROFILE_ACTIONS,
  STAFF_EDIT_ACTIONS,
  TIP_ACTIONS,
  TRANSITION_ACTIONS,
} from './audit-context.data';

describe('AuditAction', () => {
  it('keeps every stored verb, each once', () => {
    expect(new Set(AUDIT_ACTIONS).size).toBe(AUDIT_ACTIONS.length);
    for (const action of AUDIT_ACTIONS) {
      expect(action).toMatch(/^(booking|loyalty|ops|profile)\.[A-Za-z_]+$/);
    }
    // Spot-check the strings today's writers store.
    expect(AuditAction.BookingStaffAddSeat).toBe('booking.staff_addSeat');
    expect(AuditAction.BookingStaffReinstate).toBe('booking.staff_reinstate');
    expect(AuditAction.OpsBackfill).toBe('ops.backfill');
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
    expect(AuditContext.isAuditAction('booking.cancelled')).toBe(true);
    expect(AuditContext.isAuditAction('register_user')).toBe(false);
    expect(AuditContext.isAuditAction(undefined)).toBe(false);
  });
});

describe('AuditContext — one variant per verb family, every field present', () => {
  it('placement / staff edit / reschedule / cancel', () => {
    expect(
      AuditContext.placement(
        AuditAction.BookingCommitted,
        LocationId.of('loc-1'),
      ),
    ).toEqual({ kind: 'booking.committed', locationId: 'loc-1' });
    expect(AuditContext.staffEdit(AuditAction.BookingStaffMove, 7)).toEqual({
      kind: 'booking.staff_move',
      revision: 7,
    });
    expect(AuditContext.rescheduled(3, true)).toEqual({
      kind: 'booking.rescheduled',
      revision: 3,
      loggedOnRetry: true,
    });
    expect(AuditContext.cancelled('schedule_conflict')).toEqual({
      kind: 'booking.cancelled',
      reason: 'schedule_conflict',
    });
  });

  it('transition / arrival / tip', () => {
    expect(
      AuditContext.transition(AuditAction.BookingStaffNoShow, null, 's-1'),
    ).toEqual({ kind: 'booking.staff_no_show', reason: null, seatId: 's-1' });
    expect(AuditContext.arrival(AuditAction.BookingStaffArrived)).toEqual({
      kind: 'booking.staff_arrived',
    });
    expect(AuditContext.tip(AuditAction.BookingTipCleared, 's-2')).toEqual({
      kind: 'booking.tip_cleared',
      seatId: 's-2',
    });
  });

  it('streak published / withdrawn copy their facts', () => {
    const changed = ['interval'];
    const published = AuditContext.streakPublished({
      from: 1,
      to: 2,
      effectiveFrom: '2026-11-01',
      transition: 'next_day',
      direction: 'stricter',
      changed,
      replaced: null,
    });
    changed.push('qualifier');
    expect(published).toEqual({
      kind: 'loyalty.streak_definition_published',
      from: 1,
      to: 2,
      effectiveFrom: '2026-11-01',
      transition: 'next_day',
      direction: 'stricter',
      changed: ['interval'],
      replaced: null,
    });
    expect(
      AuditContext.streakWithdrawn({
        from: 2,
        to: 1,
        effectiveFrom: '2026-11-01',
        transition: 'next_day',
      }),
    ).toEqual({
      kind: 'loyalty.streak_definition_withdrawn',
      from: 2,
      to: 1,
      effectiveFrom: '2026-11-01',
      transition: 'next_day',
    });
  });

  it('backfill keeps every page figure, null when the call threw', () => {
    expect(
      AuditContext.backfill({
        job: BackfillJobKind.ClientStats,
        outcome: BackfillOutcome.Failed,
        failureCode: 'deadline-exceeded',
        processed: null,
        storedClients: null,
        done: null,
        budgetSpent: null,
        cursor: null,
      }),
    ).toEqual({
      kind: 'ops.backfill',
      job: 'clientStats',
      outcome: 'failed',
      failureCode: 'deadline-exceeded',
      processed: null,
      storedClients: null,
      done: null,
      budgetSpent: null,
      cursor: null,
    });
  });

  it('profile copies the changed field names', () => {
    const fields = ['firstName'];
    const context = AuditContext.profile(AuditAction.ProfileUpdated, fields);
    fields.push('phone');
    expect(context).toEqual({ kind: 'profile.updated', fields: ['firstName'] });
  });
});
