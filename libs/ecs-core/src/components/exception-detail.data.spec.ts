import { describe, expect, it } from 'vitest';
import { LocationId } from '../entities/location.entity';
import { ExceptionDetail, ExceptionReason } from './exception-detail.data';
import { MinuteRange } from './minute-range.data';

describe('ExceptionDetail', () => {
  it('names every reason the staff editor knows, verbatim', () => {
    expect(Object.values(ExceptionReason).sort()).toEqual([
      'admin',
      'break',
      'closed',
      'hours',
      'sick',
      'time_off',
      'training',
      'travel',
    ]);
  });

  it('builds one plain struct per reason, each carrying only what it needs', () => {
    const lunch = [MinuteRange.of(780, 840)];
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
    expect(details.map((detail) => detail.kind).sort()).toEqual(
      Object.values(ExceptionReason).sort(),
    );
    expect(ExceptionDetail.break(lunch, false)).toEqual({
      kind: 'break',
      ranges: lunch,
      paid: false,
    });
    expect(ExceptionDetail.travel(LocationId.of('loc-sea'))).toEqual({
      kind: 'travel',
      toLocationId: 'loc-sea',
    });
  });
});
