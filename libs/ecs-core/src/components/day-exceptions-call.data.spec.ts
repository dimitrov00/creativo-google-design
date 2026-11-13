import { describe, expect, it } from 'vitest';
import { PipelineErrorCode } from '@core/errors';
import { BarberId, LocationId } from '@core/primitives';
import {
  endMinute,
  localDate,
  minute,
  unwrapErr,
  unwrapOk,
} from '@core/testing';
import {
  DayExceptionsCall,
  DayExceptionsEdit,
  DayExceptionsRequest,
} from './day-exceptions-call.data';
import { MinuteRange } from './minute-range.data';

const IVAN = BarberId.of('ivan');
const NIKO = BarberId.of('niko');
const CENTER = LocationId.of('loc-center');
const MLADOST = LocationId.of('loc-mladost');
const DAY = localDate('2026-12-24');
const LUNCH = MinuteRange.of(minute(780), endMinute(840));

const block: DayExceptionsRequest.Block = {
  dayExceptionsEdit: DayExceptionsEdit.Block,
  barberId: IVAN,
  locationId: CENTER,
  ranges: [],
  localDates: [DAY],
};
const clear: DayExceptionsRequest.Clear = {
  dayExceptionsEdit: DayExceptionsEdit.Clear,
  barberId: IVAN,
  localDate: DAY,
  range: null,
};
const move: DayExceptionsRequest.Move = {
  dayExceptionsEdit: DayExceptionsEdit.Move,
  liftBarberId: IVAN,
  liftLocalDate: DAY,
  liftRange: LUNCH,
  writes: [
    { barberId: IVAN, locationId: CENTER, ranges: [LUNCH], localDates: [DAY] },
    { barberId: NIKO, locationId: MLADOST, ranges: [LUNCH], localDates: [DAY] },
    { barberId: NIKO, locationId: CENTER, ranges: [LUNCH], localDates: [DAY] },
  ],
};
const dayBreaks: DayExceptionsRequest.DayBreaks = {
  dayExceptionsEdit: DayExceptionsEdit.DayBreaks,
  barberId: NIKO,
  locationId: MLADOST,
  localDate: DAY,
  ranges: null,
};

describe('DayExceptionsEdit — the staff schedule’s four pens', () => {
  it('names them SCREAMING_SNAKE, each once', () => {
    expect(DayExceptionsEdit).toEqual({
      Block: 'BLOCK',
      Clear: 'CLEAR',
      Move: 'MOVE',
      DayBreaks: 'DAY_BREAKS',
    });
  });
});

describe('DayExceptionsRequest — whose days, and where', () => {
  it('names one barber and shop for a block and a day’s breaks; a lift names no shop', () => {
    expect(DayExceptionsRequest.placements(block)).toEqual([
      { barberId: IVAN, locationId: CENTER },
    ]);
    expect(DayExceptionsRequest.placements(dayBreaks)).toEqual([
      { barberId: NIKO, locationId: MLADOST },
    ]);
    expect(DayExceptionsRequest.placements(clear)).toEqual([
      { barberId: IVAN, locationId: null },
    ]);
  });

  it('names the lifted barber first for a move, then every write', () => {
    expect(DayExceptionsRequest.placements(move)).toEqual([
      { barberId: IVAN, locationId: null },
      { barberId: IVAN, locationId: CENTER },
      { barberId: NIKO, locationId: MLADOST },
      { barberId: NIKO, locationId: CENTER },
    ]);
  });

  it('lists the barbers and the shops each once, in the request’s order', () => {
    expect(DayExceptionsRequest.barberIds(move)).toEqual([IVAN, NIKO]);
    expect(DayExceptionsRequest.locationIds(move)).toEqual([CENTER, MLADOST]);
    expect(DayExceptionsRequest.barberIds(clear)).toEqual([IVAN]);
    expect(DayExceptionsRequest.locationIds(clear)).toEqual([]);
  });
});

describe('DayExceptionsCall.decodeSaved — the barbers an act named', () => {
  it('reads the list, and nothing else', () => {
    expect(
      unwrapOk(
        DayExceptionsCall.decodeSaved({ barberIds: ['ivan', 'niko'], x: 1 }),
      ),
    ).toEqual({ barberIds: [IVAN, NIKO] });
  });

  it('refuses an answer with nothing usable in it as PIPELINE_UNKNOWN', () => {
    for (const raw of [
      null,
      'ivan',
      {},
      { barberIds: 'ivan' },
      { barberIds: [] },
      { barberIds: ['ivan', 7] },
      { barberIds: [''] },
    ]) {
      expect(
        unwrapErr(DayExceptionsCall.decodeSaved(raw)).errorCode,
        JSON.stringify(raw),
      ).toBe(PipelineErrorCode.Unknown);
    }
  });
});
