import { describe, expect, it } from 'vitest';
import {
  AnalyticsCall,
  ClientPrivacyCall,
  DayExceptionsCall,
  PermissionsCall,
  RolesCall,
  SetAnalyticsGoalCall,
  TeamCall,
} from '@core/components';
import { AppCheckTokenUse, Tag } from '@core/primitives';
import {
  CALLABLE_ANSWER_DECODERS,
  CALLABLE_APP_CHECK_TOKEN,
  Callables,
  OPERATION_ID_FIELD,
} from './callables';

/** The table's rows, as `[callable, field]` pairs in declaration order. */
const ROWS = Object.entries(OPERATION_ID_FIELD);

describe('OPERATION_ID_FIELD — where each callable carries its operation id (WS-4.1)', () => {
  it('is total over the registry: one row per callable, no other key', () => {
    const names = ROWS.map(([name]) => name).sort();
    expect(names).toEqual(Object.values(Callables).sort());
    expect(names).toEqual(Object.keys(CALLABLE_ANSWER_DECODERS).sort());
  });

  it('pins every row that is not `operationId`: three other fields and the sink’s none', () => {
    expect(ROWS.filter(([, field]) => field !== 'operationId')).toEqual([
      [Callables.CommitBooking, 'attemptId'],
      [Callables.RescheduleAppointment, 'attemptId'],
      [Callables.PublishStreakDefinition, 'requestId'],
      [Callables.ReportClientIssues, null],
    ]);
  });

  it('every mutating booking act rides `operationId` — the staff edit’s spelling (RU-20)', () => {
    expect(OPERATION_ID_FIELD).toMatchObject({
      [Callables.CancelAppointment]: 'operationId',
      [Callables.TransitionAppointment]: 'operationId',
      [Callables.MarkArrived]: 'operationId',
      [Callables.ClearArrival]: 'operationId',
      [Callables.RecordSeatTip]: 'operationId',
      [Callables.StaffEditAppointment]: 'operationId',
    });
  });

  it('the data-subject export rides `operationId` — the field its input names (Phase 3 WS-C)', () => {
    expect(OPERATION_ID_FIELD[Callables.ExportClientData]).toBe('operationId');
    expect(Callables.ExportClientData).toBe('exportClientData');
    expect(CALLABLE_ANSWER_DECODERS[Callables.ExportClientData]).toBe(
      ClientPrivacyCall.decodeExported,
    );
  });

  it('the erasure’s preview and act ride `operationId` — one act, one id, each answer its own decoder (Phase 3 WS-D)', () => {
    expect(Callables.PreviewClientErasure).toBe('previewClientErasure');
    expect(Callables.EraseClient).toBe('eraseClient');
    expect(OPERATION_ID_FIELD[Callables.PreviewClientErasure]).toBe(
      'operationId',
    );
    expect(OPERATION_ID_FIELD[Callables.EraseClient]).toBe('operationId');
    expect(CALLABLE_ANSWER_DECODERS[Callables.PreviewClientErasure]).toBe(
      ClientPrivacyCall.decodeErasurePreview,
    );
    expect(CALLABLE_ANSWER_DECODERS[Callables.EraseClient]).toBe(
      ClientPrivacyCall.decodeErasure,
    );
  });

  it('the roles change rides `operationId` — the transport id, the impersonation calls’ shape (security hardening S-WS-E)', () => {
    expect(Callables.SetRoles).toBe('setRoles');
    expect(OPERATION_ID_FIELD[Callables.SetRoles]).toBe('operationId');
    expect(CALLABLE_ANSWER_DECODERS[Callables.SetRoles]).toBe(
      RolesCall.decodeChanged,
    );
  });

  it('staff analytics, a read, rides `operationId` for correlation only, a standard token, the report’s decoder', () => {
    expect(Callables.StaffAnalytics).toBe('staffAnalytics');
    expect(OPERATION_ID_FIELD[Callables.StaffAnalytics]).toBe('operationId');
    expect(CALLABLE_APP_CHECK_TOKEN[Callables.StaffAnalytics]).toBe(
      AppCheckTokenUse.Standard,
    );
    expect(CALLABLE_ANSWER_DECODERS[Callables.StaffAnalytics]).toBe(
      AnalyticsCall.decodeReport,
    );
  });

  it('a goal set (v2 PR 6) rides `operationId`, a standard token, the goal call’s decoder', () => {
    expect(Callables.SetAnalyticsGoal).toBe('setAnalyticsGoal');
    expect(OPERATION_ID_FIELD[Callables.SetAnalyticsGoal]).toBe('operationId');
    expect(CALLABLE_APP_CHECK_TOKEN[Callables.SetAnalyticsGoal]).toBe(
      AppCheckTokenUse.Standard,
    );
    expect(CALLABLE_ANSWER_DECODERS[Callables.SetAnalyticsGoal]).toBe(
      SetAnalyticsGoalCall.decodeSet,
    );
  });

  it('the barber record’s four and the offerings save (team onboarding) ride `operationId`, a standard token, the team call’s decoders', () => {
    expect(Callables.AddBarber).toBe('addBarber');
    expect(Callables.EditBarber).toBe('editBarber');
    expect(Callables.ActivateBarber).toBe('activateBarber');
    expect(Callables.DeleteDraftBarber).toBe('deleteDraftBarber');
    expect(Callables.SetBarberOfferings).toBe('setBarberOfferings');
    expect(OPERATION_ID_FIELD).toMatchObject({
      [Callables.AddBarber]: 'operationId',
      [Callables.EditBarber]: 'operationId',
      [Callables.ActivateBarber]: 'operationId',
      [Callables.DeleteDraftBarber]: 'operationId',
      [Callables.SetBarberOfferings]: 'operationId',
    });
    expect(CALLABLE_APP_CHECK_TOKEN).toMatchObject({
      [Callables.AddBarber]: AppCheckTokenUse.Standard,
      [Callables.EditBarber]: AppCheckTokenUse.Standard,
      [Callables.ActivateBarber]: AppCheckTokenUse.Standard,
      [Callables.DeleteDraftBarber]: AppCheckTokenUse.Standard,
      [Callables.SetBarberOfferings]: AppCheckTokenUse.Standard,
    });
    expect(CALLABLE_ANSWER_DECODERS[Callables.AddBarber]).toBe(
      TeamCall.decodeSaved,
    );
    expect(CALLABLE_ANSWER_DECODERS[Callables.EditBarber]).toBe(
      TeamCall.decodeSaved,
    );
    expect(CALLABLE_ANSWER_DECODERS[Callables.DeleteDraftBarber]).toBe(
      TeamCall.decodeSaved,
    );
    expect(CALLABLE_ANSWER_DECODERS[Callables.ActivateBarber]).toBe(
      TeamCall.decodeActivation,
    );
    expect(CALLABLE_ANSWER_DECODERS[Callables.SetBarberOfferings]).toBe(
      TeamCall.decodeSaved,
    );
  });

  it('the day-exceptions save (team onboarding O4) rides `operationId`, a standard token, its own decoder', () => {
    expect(Callables.SetDayExceptions).toBe('setDayExceptions');
    expect(OPERATION_ID_FIELD[Callables.SetDayExceptions]).toBe('operationId');
    expect(CALLABLE_APP_CHECK_TOKEN[Callables.SetDayExceptions]).toBe(
      AppCheckTokenUse.Standard,
    );
    expect(CALLABLE_ANSWER_DECODERS[Callables.SetDayExceptions]).toBe(
      DayExceptionsCall.decodeSaved,
    );
  });

  it('the Team page’s read (team onboarding D8) rides `operationId` for correlation only, a standard token, the list’s decoder', () => {
    expect(Callables.ListTeam).toBe('listTeam');
    expect(OPERATION_ID_FIELD[Callables.ListTeam]).toBe('operationId');
    expect(CALLABLE_APP_CHECK_TOKEN[Callables.ListTeam]).toBe(
      AppCheckTokenUse.Standard,
    );
    expect(CALLABLE_ANSWER_DECODERS[Callables.ListTeam]).toBe(
      TeamCall.decodeListed,
    );
  });

  it('the permissions save (staff permissions P6) names itself by `operationId`, takes a limited-use token like the roles change, and answers through its own decoder', () => {
    expect(Callables.SetStaffPermissions).toBe('setStaffPermissions');
    expect(OPERATION_ID_FIELD[Callables.SetStaffPermissions]).toBe(
      'operationId',
    );
    expect(CALLABLE_APP_CHECK_TOKEN[Callables.SetStaffPermissions]).toBe(
      AppCheckTokenUse.LimitedUse,
    );
    expect(CALLABLE_ANSWER_DECODERS[Callables.SetStaffPermissions]).toBe(
      PermissionsCall.decodeSaved,
    );
  });

  it('the client issue sink alone carries none (OR-34)', () => {
    expect(ROWS.filter(([, field]) => field === null)).toEqual([
      [Callables.ReportClientIssues, null],
    ]);
  });
});

describe('CALLABLE_APP_CHECK_TOKEN — the token each callable takes (security hardening S-RU-21)', () => {
  it('is total over the registry: one row per callable, no other key', () => {
    expect(Object.keys(CALLABLE_APP_CHECK_TOKEN).sort()).toEqual(
      Object.values(Callables).sort(),
    );
    for (const use of Object.values(CALLABLE_APP_CHECK_TOKEN)) {
      expect(Tag.has(AppCheckTokenUse, use)).toBe(true);
    }
  });

  it('names exactly the six destructive / sensitive callables LIMITED_USE (S-L-3; staff permissions P6)', () => {
    const limited = Object.entries(CALLABLE_APP_CHECK_TOKEN)
      .filter(([, use]) => use === AppCheckTokenUse.LimitedUse)
      .map(([name]) => name)
      .sort();
    expect(limited).toEqual(
      [
        Callables.EraseClient,
        Callables.PreviewClientErasure,
        Callables.ExportClientData,
        Callables.StartImpersonation,
        Callables.SetRoles,
        Callables.SetStaffPermissions,
      ].sort(),
    );
  });

  it('every other callable — the client issue sink and the impersonation end included — takes a standard token', () => {
    const standard = Object.entries(CALLABLE_APP_CHECK_TOKEN).filter(
      ([, use]) => use === AppCheckTokenUse.Standard,
    );
    expect(standard).toHaveLength(Object.values(Callables).length - 6);
    expect(CALLABLE_APP_CHECK_TOKEN[Callables.ReportClientIssues]).toBe(
      AppCheckTokenUse.Standard,
    );
    expect(CALLABLE_APP_CHECK_TOKEN[Callables.EndImpersonation]).toBe(
      AppCheckTokenUse.Standard,
    );
  });
});
