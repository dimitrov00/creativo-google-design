import type { CallableRequest } from 'firebase-functions/v2/https';
import { AccessErrorCode, SchedulingErrorCode } from '@core/errors';
import {
  decodeAmendRosterBreaks,
  decodeSetDayExceptions,
  decodeSetRosterWeek,
} from './roster.wire';

/*
 * `amendRosterBreaks`' wire: a caller who works the book, every field read
 * through its smart constructor, the weekdays de-duplicated in week order,
 * and a change that changes nothing refused.
 */

function callable(
  data: unknown,
  roles: readonly string[] | null = ['barber'],
): CallableRequest<unknown> {
  return {
    data,
    ...(roles === null ? {} : { auth: { uid: 'u-staff', token: { roles } } }),
  } as unknown as CallableRequest<unknown>;
}

const LUNCH = { startMinutes: 780, endMinutes: 840 };
const sent = {
  barberId: 'b-ivan',
  locationId: 'loc-center',
  fromLocalDate: '2026-11-16',
  weekdays: [3, 1, 3],
  before: null,
  after: LUNCH,
  operationId: 'operation-0123456789ab',
};

const codeOf = (data: unknown, roles?: readonly string[] | null) => {
  const decoded = decodeAmendRosterBreaks(callable(data, roles));
  return decoded.ok ? null : decoded.error.errorCode;
};

describe('decodeAmendRosterBreaks', () => {
  it('reads the change, the weekdays distinct and in week order', () => {
    const decoded = decodeAmendRosterBreaks(callable(sent));
    // The change, beside the verified caller and the act's name: the
    // pipeline judges the caller's stored account and stamps the roster.
    expect(decoded).toEqual({
      ok: true,
      value: {
        barberId: sent.barberId,
        locationId: sent.locationId,
        fromLocalDate: sent.fromLocalDate,
        weekdays: [1, 3],
        before: null,
        after: LUNCH,
        callerUserId: 'u-staff',
        operationId: sent.operationId,
      },
    });
  });

  it('refuses a caller who is not signed in, or whose token holds no staff role', () => {
    expect(codeOf(sent, null)).toBe(SchedulingErrorCode.RosterUnauthenticated);
    expect(codeOf(sent, ['client'])).toBe(AccessErrorCode.NotStaff);
    expect(codeOf(sent, [])).toBe(AccessErrorCode.NotStaff);
  });

  it('lets any staff token through — whose hours it may change is the pipeline’s question (staff permissions P6)', () => {
    // The content editor's token was turned away here before; the owner may
    // now give that level hours, so the stored account decides.
    for (const role of [
      'barber',
      'receptionist',
      'content_manager',
      'admin',
      'sysadmin',
    ]) {
      expect(decodeAmendRosterBreaks(callable(sent, [role])).ok, role).toBe(
        true,
      );
    }
  });

  it.each([
    ['barberId', { barberId: '' }],
    ['fromLocalDate', { fromLocalDate: '2026-02-30' }],
    ['weekdays', { weekdays: [] }],
    ['weekdays', { weekdays: [8] }],
    ['before', { before: { startMinutes: 900, endMinutes: 840 } }],
    ['after', { after: null }],
    ['operationId', { operationId: 'short' }],
  ])('names the unreadable field %s', (field, broken) => {
    const decoded = decodeAmendRosterBreaks(callable({ ...sent, ...broken }));
    expect(decoded).toEqual({
      ok: false,
      error: { errorCode: SchedulingErrorCode.RosterInvalidInput, field },
    });
  });
});

describe('decodeSetRosterWeek', () => {
  const week = {
    barberId: 'b-ivan',
    locationId: 'loc-center',
    fromLocalDate: '2026-11-16',
    segments: [
      {
        weekday: 1,
        locationId: 'loc-center',
        startMinutes: 540,
        endMinutes: 1080,
      },
    ],
    breaks: [{ weekday: 1, ...LUNCH }],
    operationId: 'operation-0123456789ab',
  };

  it('reads the whole week, shops and breaks', () => {
    expect(decodeSetRosterWeek(callable(week))).toEqual({
      ok: true,
      value: {
        barberId: 'b-ivan',
        locationId: 'loc-center',
        fromLocalDate: '2026-11-16',
        segments: week.segments,
        breaks: week.breaks,
        callerUserId: 'u-staff',
        operationId: week.operationId,
      },
    });
  });

  it('reads an empty week — every day off', () => {
    const decoded = decodeSetRosterWeek(
      callable({ ...week, segments: [], breaks: [] }),
    );
    expect(decoded.ok).toBe(true);
  });

  it.each([
    [
      'segments',
      { segments: [{ weekday: 9, locationId: 'loc-center', ...LUNCH }] },
    ],
    ['segments', { segments: [{ weekday: 1, ...LUNCH }] }],
    [
      'breaks',
      { breaks: [{ weekday: 1, startMinutes: 900, endMinutes: 800 }] },
    ],
    [
      'segments',
      { segments: Array.from({ length: 43 }, () => week.segments[0]) },
    ],
  ])('names the unreadable field %s', (field, broken) => {
    expect(decodeSetRosterWeek(callable({ ...week, ...broken }))).toEqual({
      ok: false,
      error: { errorCode: SchedulingErrorCode.RosterInvalidInput, field },
    });
  });

  it('takes the caller off the token, never the payload', () => {
    const decoded = decodeSetRosterWeek(
      callable({ ...week, callerUserId: 'u-forged' }),
    );
    expect(decoded).toMatchObject({
      ok: true,
      value: { callerUserId: 'u-staff' },
    });
  });

  it('refuses a token that holds no staff role, and lets the content editor’s through', () => {
    const decoded = decodeSetRosterWeek(callable(week, ['client']));
    expect(decoded.ok ? null : decoded.error.errorCode).toBe(
      AccessErrorCode.NotStaff,
    );
    expect(decodeSetRosterWeek(callable(week, ['content_manager'])).ok).toBe(
      true,
    );
  });
});

describe('decodeSetDayExceptions', () => {
  const OP = 'operation-0123456789ab';
  const days = {
    barberId: 'b-ivan',
    locationId: 'loc-center',
    ranges: [LUNCH],
    localDates: ['2026-12-24', '2026-12-25'],
  };
  const block = { dayExceptionsEdit: 'BLOCK', ...days, operationId: OP };
  const clear = {
    dayExceptionsEdit: 'CLEAR',
    barberId: 'b-ivan',
    localDate: '2026-12-24',
    range: LUNCH,
    operationId: OP,
  };
  const move = {
    dayExceptionsEdit: 'MOVE',
    liftBarberId: 'b-ivan',
    liftLocalDate: '2026-12-24',
    liftRange: LUNCH,
    writes: [{ ...days, barberId: 'b-niko' }],
    operationId: OP,
  };
  const dayBreaks = {
    dayExceptionsEdit: 'DAY_BREAKS',
    barberId: 'b-ivan',
    locationId: 'loc-center',
    localDate: '2026-12-24',
    ranges: [LUNCH],
    operationId: OP,
  };
  const CALLER = { callerUserId: 'u-staff', operationId: OP };

  const refusal = (data: unknown, roles?: readonly string[] | null) => {
    const decoded = decodeSetDayExceptions(callable(data, roles));
    return decoded.ok ? null : decoded.error;
  };
  const INVALID = (field: string) => ({
    errorCode: SchedulingErrorCode.RosterInvalidInput,
    field,
  });

  it('reads each pen whole, beside the verified caller and the act’s name', () => {
    for (const sent of [block, clear, move, dayBreaks]) {
      // The command is the request with the verified caller beside it.
      expect(decodeSetDayExceptions(callable(sent))).toEqual({
        ok: true,
        value: { ...sent, ...CALLER },
      });
    }
  });

  it('reads a whole-day block, a whole-day lift and a day handed back to the roster', () => {
    expect(
      decodeSetDayExceptions(callable({ ...block, ranges: [] })),
    ).toMatchObject({ ok: true, value: { ranges: [] } });
    for (const range of [null, undefined]) {
      expect(
        decodeSetDayExceptions(callable({ ...clear, range })),
      ).toMatchObject({ ok: true, value: { range: null } });
    }
    for (const ranges of [null, undefined]) {
      expect(
        decodeSetDayExceptions(callable({ ...dayBreaks, ranges })),
      ).toMatchObject({ ok: true, value: { ranges: null } });
    }
    expect(
      decodeSetDayExceptions(callable({ ...dayBreaks, ranges: [] })),
    ).toMatchObject({ ok: true, value: { ranges: [] } });
  });

  it('names a day once, in the order given', () => {
    expect(
      decodeSetDayExceptions(
        callable({
          ...block,
          localDates: ['2026-12-25', '2026-12-24', '2026-12-25'],
        }),
      ),
    ).toMatchObject({
      ok: true,
      value: { localDates: ['2026-12-25', '2026-12-24'] },
    });
  });

  it('takes the caller off the token, never the payload', () => {
    expect(
      decodeSetDayExceptions(callable({ ...block, callerUserId: 'u-forged' })),
    ).toMatchObject({ ok: true, value: { callerUserId: 'u-staff' } });
  });

  it('refuses a caller who is not signed in, or whose token holds no staff role — before the payload is read', () => {
    expect(refusal({}, null)).toEqual({
      errorCode: SchedulingErrorCode.RosterUnauthenticated,
    });
    for (const roles of [['client'], []]) {
      expect(refusal({}, roles)).toEqual({
        errorCode: AccessErrorCode.NotStaff,
      });
    }
    // A staff token gets as far as the payload: an empty one names its field.
    expect(refusal({}, ['content_manager'])).toEqual({
      errorCode: SchedulingErrorCode.RosterInvalidInput,
      field: 'dayExceptionsEdit',
    });
  });

  it.each([
    ['dayExceptionsEdit', { dayExceptionsEdit: 'ERASE' }],
    ['dayExceptionsEdit', { dayExceptionsEdit: undefined }],
    ['operationId', { operationId: 'short' }],
    ['barberId', { barberId: '' }],
    ['locationId', { locationId: 'a/b' }],
    ['ranges', { ranges: undefined }],
    ['ranges', { ranges: [{ startMinutes: 840, endMinutes: 780 }] }],
    ['ranges', { ranges: Array.from({ length: 25 }, () => LUNCH) }],
    ['localDates', { localDates: [] }],
    ['localDates', { localDates: ['2026-02-30'] }],
    [
      'localDates',
      { localDates: Array.from({ length: 367 }, () => '2026-12-24') },
    ],
  ])('names %s as the unreadable field of a block', (field, change) => {
    expect(refusal({ ...block, ...change })).toEqual(INVALID(field));
  });

  it.each([
    ['localDate', clear, { localDate: 'today' }],
    ['range', clear, { range: { startMinutes: 1, endMinutes: 1 } }],
    ['liftBarberId', move, { liftBarberId: 7 }],
    ['liftLocalDate', move, { liftLocalDate: '2026-13-01' }],
    ['liftRange', move, { liftRange: null }],
    ['writes', move, { writes: [] }],
    ['writes', move, { writes: ['b-niko'] }],
    ['writes', move, { writes: [{ ...days, localDates: [] }] }],
    ['writes', move, { writes: Array.from({ length: 21 }, () => days) }],
    ['ranges', dayBreaks, { ranges: 'none' }],
    ['localDate', dayBreaks, { localDate: undefined }],
  ])('names %s as the unreadable field of its pen', (field, sent, change) => {
    expect(refusal({ ...sent, ...change })).toEqual(INVALID(field));
  });

  it('refuses a move that would write more days than one transaction holds', () => {
    const year = Array.from({ length: 366 }, (_, i) => {
      const day = String((i % 28) + 1).padStart(2, '0');
      const month = String((Math.floor(i / 28) % 12) + 1).padStart(2, '0');
      const year = 2026 + Math.floor(i / 336);
      return `${year}-${month}-${day}`;
    });
    expect(
      refusal({
        ...move,
        writes: [
          { ...days, localDates: year },
          { ...days, barberId: 'b-niko', localDates: year },
        ],
      }),
    ).toEqual(INVALID('writes'));
  });
});
