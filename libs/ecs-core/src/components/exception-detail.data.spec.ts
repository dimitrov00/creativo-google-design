import { describe, expect, it } from 'vitest';
import { LocationId } from '../primitives/ids.primitive';
import { endMinute, minute } from '../testing';
import { ExceptionDetail, ExceptionReason } from './exception-detail.data';
import { MinuteRange } from './minute-range.data';

describe('ExceptionDetail', () => {
  it('names every reason the staff editor knows, SCREAMING', () => {
    expect(Object.values(ExceptionReason).sort()).toEqual([
      'ADMIN',
      'BREAK',
      'CLOSED',
      'HOURS',
      'SICK',
      'TIME_OFF',
      'TRAINING',
      'TRAVEL',
    ]);
  });

  it('builds one flat struct per reason, each carrying only what it needs', () => {
    const lunch = [MinuteRange.of(minute(780), endMinute(840))];
    const details: readonly ExceptionDetail[] = [
      ExceptionDetail.closed(),
      ExceptionDetail.timeOff(),
      ExceptionDetail.sick(true),
      ExceptionDetail.training(null),
      ExceptionDetail.travel(LocationId.of('loc-sea')),
      ExceptionDetail.hours(lunch),
      ExceptionDetail.break(lunch, false),
      ExceptionDetail.admin(lunch, 'stock-take'),
    ];
    expect(details.map((detail) => detail.exceptionReason).sort()).toEqual(
      Object.values(ExceptionReason).sort(),
    );
    expect(ExceptionDetail.break(lunch, false)).toEqual({
      exceptionReason: 'BREAK',
      exceptionRanges: lunch,
      breakPaid: false,
    });
    expect(ExceptionDetail.travel(LocationId.of('loc-sea'))).toEqual({
      exceptionReason: 'TRAVEL',
      travelToLocationId: 'loc-sea',
    });
  });
});
