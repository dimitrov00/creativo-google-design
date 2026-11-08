import type { CallableRequest } from 'firebase-functions/v2/https';
import { AnalyticsErrorCode } from '@core/errors';
import { decodeStaffAnalytics } from './analytics.wire';

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
