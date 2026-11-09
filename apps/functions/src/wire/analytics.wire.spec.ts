import type { CallableRequest } from 'firebase-functions/v2/https';
import { AnalyticsErrorCode } from '@core/errors';
import { decodeSetAnalyticsGoal, decodeStaffAnalytics } from './analytics.wire';

/*
 * `staffAnalytics`' wire: signed in, a token role that reads analytics (the
 * first gate — the pipeline judges the stored roles), every field through
 * its smart constructor, the first unreadable one named. The v2 call: the
 * five spans and the `CUSTOM` range's last day.
 */

function callable(
  data: unknown,
  roles: readonly unknown[] | null = ['barber'],
): CallableRequest<unknown> {
  return {
    data,
    ...(roles === null ? {} : { auth: { uid: 'u-ivan', token: { roles } } }),
  } as unknown as CallableRequest<unknown>;
}

const sent = {
  scopeBarberId: 'b-ivan',
  fromLocalDate: '2026-09-01',
  toLocalDate: null,
  analyticsSpan: 'MONTH',
  analyticsComparison: 'PREVIOUS',
  operationId: 'operation-0123456789ab',
};

const refusalOf = (data: unknown, roles?: readonly unknown[] | null) => {
  const decoded = decodeStaffAnalytics(callable(data, roles));
  return decoded.ok ? null : decoded.error;
};

describe('decodeStaffAnalytics', () => {
  it('reads the request and the verified caller — never the operation id', () => {
    expect(decodeStaffAnalytics(callable(sent))).toEqual({
      ok: true,
      value: {
        callerUserId: 'u-ivan',
        scopeBarberId: 'b-ivan',
        fromLocalDate: '2026-09-01',
        toLocalDate: null,
        analyticsSpan: 'MONTH',
        analyticsComparison: 'PREVIOUS',
      },
    });
  });

  it('reads a `null` or absent scope as the default scope, and an absent `to` as none', () => {
    for (const data of [
      { ...sent, scopeBarberId: null },
      {
        fromLocalDate: '2026-09-28',
        analyticsSpan: 'WEEK',
        analyticsComparison: 'PREVIOUS',
      },
    ]) {
      const decoded = decodeStaffAnalytics(callable(data));
      expect(decoded.ok && decoded.value.scopeBarberId).toBeNull();
      expect(decoded.ok && decoded.value.toLocalDate).toBeNull();
    }
  });

  it('decodes the v2 spans: a YEAR, and a CUSTOM range with its last day', () => {
    expect(
      decodeStaffAnalytics(
        callable({
          ...sent,
          fromLocalDate: '2026-01-01',
          analyticsSpan: 'YEAR',
        }),
      ),
    ).toEqual({
      ok: true,
      value: {
        callerUserId: 'u-ivan',
        scopeBarberId: 'b-ivan',
        fromLocalDate: '2026-01-01',
        toLocalDate: null,
        analyticsSpan: 'YEAR',
        analyticsComparison: 'PREVIOUS',
      },
    });
    expect(
      decodeStaffAnalytics(
        callable({
          ...sent,
          fromLocalDate: '2026-09-07',
          toLocalDate: '2026-09-20',
          analyticsSpan: 'CUSTOM',
        }),
      ),
    ).toEqual({
      ok: true,
      value: {
        callerUserId: 'u-ivan',
        scopeBarberId: 'b-ivan',
        fromLocalDate: '2026-09-07',
        toLocalDate: '2026-09-20',
        analyticsSpan: 'CUSTOM',
        analyticsComparison: 'PREVIOUS',
      },
    });
    // Whether a `to` belongs to the span is the pipeline's question: the
    // wire passes a well-formed pair through as sent.
    const decoded = decodeStaffAnalytics(
      callable({ ...sent, toLocalDate: '2026-09-30' }),
    );
    expect(decoded.ok && decoded.value.toLocalDate).toBe('2026-09-30');
    const none = decodeStaffAnalytics(
      callable({ ...sent, analyticsSpan: 'CUSTOM' }),
    );
    expect(none.ok && none.value.toLocalDate).toBeNull();
  });

  it('refuses a caller who is not signed in', () => {
    expect(refusalOf(sent, null)).toEqual({
      errorCode: AnalyticsErrorCode.Unauthenticated,
    });
  });

  it('refuses a token that claims no role reading analytics', () => {
    for (const roles of [
      ['client'],
      ['receptionist'],
      ['sysadmin'],
      ['content_manager'],
      [],
      [['admin']],
    ]) {
      expect(refusalOf(sent, roles)).toEqual({
        errorCode: AnalyticsErrorCode.Forbidden,
      });
    }
    for (const roles of [['barber'], ['admin'], ['admin', 'barber']]) {
      expect(refusalOf(sent, roles)).toBeNull();
    }
  });

  it.each([
    ['scopeBarberId', { scopeBarberId: '' }],
    ['scopeBarberId', { scopeBarberId: 'a/b' }],
    ['scopeBarberId', { scopeBarberId: 7 }],
    ['fromLocalDate', { fromLocalDate: '2026-02-30' }],
    ['fromLocalDate', { fromLocalDate: undefined }],
    ['toLocalDate', { toLocalDate: '2026-02-30' }],
    ['toLocalDate', { toLocalDate: 20260930 }],
    ['toLocalDate', { toLocalDate: '' }],
    ['analyticsSpan', { analyticsSpan: 'QUARTER' }],
    ['analyticsSpan', { analyticsSpan: 'year' }],
    ['analyticsSpan', { analyticsSpan: undefined }],
    ['analyticsComparison', { analyticsComparison: 'SAME_LAST_YEAR' }],
    ['analyticsComparison', { analyticsComparison: 'previous' }],
    ['analyticsComparison', { analyticsComparison: undefined }],
  ])('names the malformed field %s', (field, change) => {
    expect(refusalOf({ ...sent, ...change })).toEqual({
      errorCode: AnalyticsErrorCode.InvalidInput,
      field,
    });
  });

  it('refuses a payload that is no object field by field', () => {
    expect(refusalOf('report')).toEqual({
      errorCode: AnalyticsErrorCode.InvalidInput,
      field: 'fromLocalDate',
    });
  });
});

/*
 * `setAnalyticsGoal`'s wire (v2 PR 6): the report's two gates, then the
 * scope, the month and the two bounds through their guards; the operation id
 * is read — the goal's audit row is keyed by it.
 */
const goalSent = {
  scopeBarberId: null,
  goalMonth: '2026-11',
  goalLowCents: 180000,
  goalHighCents: 220000,
  operationId: 'operation-0123456789ab',
};

const goalRefusalOf = (data: unknown, roles?: readonly unknown[] | null) => {
  const decoded = decodeSetAnalyticsGoal(callable(data, roles));
  return decoded.ok ? null : decoded.error;
};

describe('decodeSetAnalyticsGoal', () => {
  it('reads the call, the verified caller and the operation id', () => {
    expect(decodeSetAnalyticsGoal(callable(goalSent))).toEqual({
      ok: true,
      value: {
        callerUserId: 'u-ivan',
        scopeBarberId: null,
        goalMonth: '2026-11',
        goalLowCents: 180000,
        goalHighCents: 220000,
        operationId: 'operation-0123456789ab',
      },
    });
    const scoped = decodeSetAnalyticsGoal(
      callable({ ...goalSent, scopeBarberId: 'b-ivan' }),
    );
    expect(scoped.ok && scoped.value.scopeBarberId).toBe('b-ivan');
  });

  it('reads an absent or malformed operation id as none — never refused', () => {
    for (const data of [
      { ...goalSent, operationId: undefined },
      { ...goalSent, operationId: 'short' },
      { ...goalSent, operationId: 7 },
    ]) {
      const decoded = decodeSetAnalyticsGoal(callable(data));
      expect(decoded.ok && decoded.value.operationId).toBeNull();
    }
  });

  it('passes a range that is no range through — the pipeline’s question (ANALYTICS_GOAL_INVALID_RANGE), not the wire’s', () => {
    const decoded = decodeSetAnalyticsGoal(
      callable({ ...goalSent, goalLowCents: 0, goalHighCents: 0 }),
    );
    expect(decoded.ok && decoded.value.goalLowCents).toBe(0);
    const inverted = decodeSetAnalyticsGoal(
      callable({ ...goalSent, goalLowCents: 220000, goalHighCents: 180000 }),
    );
    expect(inverted.ok).toBe(true);
    // A past month too: which months are allowed is the pipeline's rule.
    expect(
      decodeSetAnalyticsGoal(callable({ ...goalSent, goalMonth: '2020-01' }))
        .ok,
    ).toBe(true);
  });

  it('refuses a caller who is not signed in, and a token with no analytics role', () => {
    expect(goalRefusalOf(goalSent, null)).toEqual({
      errorCode: AnalyticsErrorCode.Unauthenticated,
    });
    for (const roles of [['client'], ['receptionist'], []]) {
      expect(goalRefusalOf(goalSent, roles)).toEqual({
        errorCode: AnalyticsErrorCode.Forbidden,
      });
    }
    for (const roles of [['barber'], ['admin']]) {
      expect(goalRefusalOf(goalSent, roles)).toBeNull();
    }
  });

  it('names the first field its primitive refuses', () => {
    for (const [data, field] of [
      [{ ...goalSent, scopeBarberId: 'a/b' }, 'scopeBarberId'],
      [{ ...goalSent, scopeBarberId: 7 }, 'scopeBarberId'],
      [{ ...goalSent, goalMonth: '2026-11-01' }, 'goalMonth'],
      [{ ...goalSent, goalMonth: '2026-13' }, 'goalMonth'],
      [{ ...goalSent, goalMonth: undefined }, 'goalMonth'],
      [{ ...goalSent, goalLowCents: '180000' }, 'goalLowCents'],
      [{ ...goalSent, goalLowCents: -1 }, 'goalLowCents'],
      [{ ...goalSent, goalLowCents: 1.5 }, 'goalLowCents'],
      [{ ...goalSent, goalHighCents: undefined }, 'goalHighCents'],
      [{ ...goalSent, goalHighCents: Number.NaN }, 'goalHighCents'],
      ['goal', 'goalMonth'],
    ] as const) {
      expect(goalRefusalOf(data)).toEqual({
        errorCode: AnalyticsErrorCode.InvalidInput,
        field,
      });
    }
  });
});
