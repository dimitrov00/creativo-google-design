import type { CallableRequest } from 'firebase-functions/v2/https';
import { SchedulingErrorCode } from '@core/errors';
import { decodeAmendRosterBreaks, decodeSetRosterWeek } from './roster.wire';

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
    // The act's name stays at the edge: the command is the change alone.
    expect(decoded).toEqual({
      ok: true,
      value: {
        barberId: sent.barberId,
        locationId: sent.locationId,
        fromLocalDate: sent.fromLocalDate,
        weekdays: [1, 3],
        before: null,
        after: LUNCH,
      },
    });
  });

  it('refuses a caller who is not signed in, or does not work the book', () => {
    expect(codeOf(sent, null)).toBe(SchedulingErrorCode.RosterUnauthenticated);
    expect(codeOf(sent, ['client'])).toBe(SchedulingErrorCode.RosterForbidden);
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

  it('refuses a caller who does not work the book', () => {
    const decoded = decodeSetRosterWeek(callable(week, ['client']));
    expect(decoded.ok ? null : decoded.error.errorCode).toBe(
      SchedulingErrorCode.RosterForbidden,
    );
  });
});
