import { describe, expect, it } from 'vitest';
import {
  FIXTURE_TIME_ZONE,
  appointmentFixture,
  deepFreeze,
  endMinute,
  localDate,
  minute,
  utcMs,
} from '@core/testing';
import { ZonedTimeSystem } from '@core/systems';
import { MinuteRange } from './minute-range.data';
import { TimeCoordinate } from './time-coordinate.data';

const DAY = localDate('2026-10-07');

function time(start: number, end: number, day = DAY): TimeCoordinate {
  const startMinutes = minute(start);
  const instant = ZonedTimeSystem.toUtc(day, startMinutes, FIXTURE_TIME_ZONE);
  if (!instant.ok) throw new Error('bad fixture');
  return {
    localDate: day,
    startMinutes,
    endMinutes: endMinute(end),
    utcEpochMs: instant.value,
  };
}

describe('TimeCoordinate — the shop wall clock and the one instant', () => {
  it('measures the envelope on the wall clock', () => {
    expect(TimeCoordinate.durationMinutes(time(600, 645))).toBe(45);
    expect(TimeCoordinate.durationMinutes(time(600, 600))).toBe(0);
  });

  it('overlaps only on the same day, half-open', () => {
    expect(TimeCoordinate.overlaps(time(600, 645), time(630, 700))).toBe(true);
    expect(TimeCoordinate.overlaps(time(600, 645), time(645, 700))).toBe(false);
    expect(
      TimeCoordinate.overlaps(
        time(600, 645),
        time(600, 645, localDate('2026-10-08')),
      ),
    ).toBe(false);
  });

  it('places a seat’s start on the absolute timeline by its distance from the envelope (T9)', () => {
    const visit = time(600, 700);
    expect(visit.utcEpochMs).toBe(utcMs('2026-10-07T10:00:00+03:00'));
    expect(TimeCoordinate.instantAt(visit, minute(645))).toBe(
      utcMs('2026-10-07T10:45:00+03:00'),
    );
    expect(TimeCoordinate.instantAt(visit, minute(600))).toBe(visit.utcEpochMs);
  });

  it('is pure: same input, same output, input untouched', () => {
    const visit = Object.freeze(time(600, 700));
    const once = TimeCoordinate.instantAt(visit, minute(630));
    expect(TimeCoordinate.instantAt(visit, minute(630))).toBe(once);
    expect(visit.startMinutes).toBe(600);
  });
});

describe('TimeCoordinate.instantAt — any minute of the visit’s day, as an instant (the folded seatStartUtcMs)', () => {
  it('takes an exclusive end as well as a start — the closing midnight included', () => {
    const visit = time(600, 700);
    expect(TimeCoordinate.instantAt(visit, endMinute(700))).toBe(
      utcMs('2026-10-07T11:40:00+03:00'),
    );
    const late = time(23 * 60, 1440);
    expect(TimeCoordinate.instantAt(late, endMinute(1440))).toBe(
      utcMs('2026-10-08T00:00:00+03:00'),
    );
  });

  it('reads a seat’s start as the stored instant plus its wall-clock distance (the retired seatStartUtcMs’s arithmetic)', () => {
    const visit = time(600, 700);
    for (const at of [600, 615, 645, 699]) {
      expect(TimeCoordinate.instantAt(visit, minute(at))).toBe(
        visit.utcEpochMs + (at - 600) * 60_000,
      );
    }
  });

  /*
   * Exact for every visit that does not STRADDLE a DST switch — which none
   * does, the shop is closed at 03:00/04:00. Pinned, so the arithmetic is
   * documented where it would read off: the stored instant plus the
   * wall-clock distance, never a zone read.
   */
  it('across Sofia’s spring-forward (2026-03-29): stored instant + wall distance, an hour past the wall clock', () => {
    const day = localDate('2026-03-29');
    const visit = {
      localDate: day,
      startMinutes: minute(2 * 60 + 30),
      endMinutes: endMinute(4 * 60 + 30),
      utcEpochMs: utcMs('2026-03-29T02:30:00+02:00'),
    };
    // 120 wall minutes on; 04:30 EEST is only 60 elapsed minutes after 02:30 EET.
    expect(TimeCoordinate.instantAt(visit, endMinute(4 * 60 + 30))).toBe(
      utcMs('2026-03-29T05:30:00+03:00'),
    );
    expect(TimeCoordinate.endUtcMs(visit)).toBe(utcMs('2026-03-29T02:30:00Z'));
  });

  it('across Sofia’s fall-back (2026-10-25): stored instant + wall distance, an hour short of the wall clock', () => {
    const day = localDate('2026-10-25');
    const visit = {
      localDate: day,
      startMinutes: minute(3 * 60 + 30),
      endMinutes: endMinute(4 * 60 + 30),
      // Ingestion resolves the repeated 03:30 to the EARLIER offset (+03:00).
      utcEpochMs: utcMs('2026-10-25T03:30:00+03:00'),
    };
    // 60 wall minutes on; 04:30 EET is 120 elapsed minutes after 03:30 EEST.
    expect(TimeCoordinate.instantAt(visit, endMinute(4 * 60 + 30))).toBe(
      utcMs('2026-10-25T03:30:00+02:00'),
    );
  });
});

describe('TimeCoordinate.endUtcMs — the envelope’s end as an instant (.ics)', () => {
  it('is the start as stored plus the sold span of real time', () => {
    expect(TimeCoordinate.endUtcMs(time(600, 645))).toBe(
      utcMs('2026-10-07T10:45:00+03:00'),
    );
    expect(TimeCoordinate.endUtcMs(time(23 * 60, 1440))).toBe(
      utcMs('2026-10-08T00:00:00+03:00'),
    );
  });

  it('is the start itself for an empty envelope', () => {
    const empty = time(600, 600);
    expect(TimeCoordinate.endUtcMs(empty)).toBe(empty.utcEpochMs);
  });

  it('adds the minutes to the instant as stored, whatever the wall clock says', () => {
    const shifted = {
      ...time(600, 660),
      utcEpochMs: utcMs('2026-10-07T00:00:00Z'),
    };
    expect(TimeCoordinate.endUtcMs(shifted)).toBe(
      utcMs('2026-10-07T01:00:00Z'),
    );
  });

  it('is pure: same input → same output, inputs untouched', () => {
    const visit = deepFreeze(time(600, 645));
    expect(TimeCoordinate.endUtcMs(visit)).toBe(TimeCoordinate.endUtcMs(visit));
  });
});

describe('TimeCoordinate.fieldFault — the read-time check of a stored time slice (edge hardening D-1)', () => {
  it('answers null for a stored appointment’s slice — the whole entity passes by structure', () => {
    expect(TimeCoordinate.fieldFault(appointmentFixture())).toBeNull();
  });

  it('names localDate, the minutes or utcEpochMs — each broken in turn', () => {
    const slice = appointmentFixture();
    expect(
      TimeCoordinate.fieldFault({ ...slice, localDate: '2026-02-30' }),
    ).toBe('localDate');
    expect(
      TimeCoordinate.fieldFault({ ...slice, localDate: '2026-09-28T00:00' }),
    ).toBe('localDate');
    expect(TimeCoordinate.fieldFault({ ...slice, startMinutes: 'ten' })).toBe(
      'startMinutes',
    );
    expect(TimeCoordinate.fieldFault({ ...slice, endMinutes: 1441 })).toBe(
      'endMinutes',
    );
    expect(
      TimeCoordinate.fieldFault({ ...slice, utcEpochMs: '1790575200000' }),
    ).toBe('utcEpochMs');
    expect(TimeCoordinate.fieldFault({ ...slice, utcEpochMs: 1.5 })).toBe(
      'utcEpochMs',
    );
  });

  it('reads the minutes through MinuteRange — an inverted envelope answers what the range answers', () => {
    const inverted = {
      ...appointmentFixture(),
      startMinutes: 700,
      endMinutes: 600,
    };
    expect(TimeCoordinate.fieldFault(inverted)).toBe(
      MinuteRange.fieldFault(inverted),
    );
    expect(TimeCoordinate.fieldFault(inverted)).toBe('endMinutes');
  });

  it('answers the first fault in field order', () => {
    expect(
      TimeCoordinate.fieldFault({
        ...appointmentFixture(),
        localDate: null,
        utcEpochMs: null,
      }),
    ).toBe('localDate');
  });

  it('is pure: same input → same output, the input untouched', () => {
    const raw = deepFreeze(appointmentFixture());
    expect(TimeCoordinate.fieldFault(raw)).toBe(TimeCoordinate.fieldFault(raw));
    expect(raw).toEqual(appointmentFixture());
  });
});
