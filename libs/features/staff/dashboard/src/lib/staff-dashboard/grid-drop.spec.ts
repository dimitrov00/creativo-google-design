import { describe, expect, it } from 'vitest';
import { MinuteRange } from '@core/components';
import {
  AppointmentId,
  BarberId,
  Currency,
  EndMinute,
  LocalDate,
  LocationId,
  MinuteOfDay,
  PriceCents,
  TrackMinute,
} from '@core/primitives';
import { unwrapOk } from '@core/testing';
import type { VisitEditorVm } from '../visit-editor/staff-visit-editor';
import { blockDropOf, blockKeyOf, DropRoute, dropRouteOf } from './grid-drop';

const at = (minute: number) => TrackMinute.ofProven(minute);

/** A visit 10:00–10:30 in a chair rostered 9:00–18:00. */
const visit = (partial: Partial<VisitEditorVm> = {}): VisitEditorVm => ({
  appointmentId: AppointmentId.of('appt-1'),
  rowId: 'appt-1#ivan',
  peers: [],
  dayKey: unwrapOk(LocalDate.parse('2026-11-07')),
  dayLabel: 'сб, 7.11',
  startMinute: at(600),
  endMinute: at(630),
  legs: [],
  clientLabel: 'Стоян Колев',
  clientUserId: null,
  clientCustomerId: null,
  phone: null,
  phoneHref: null,
  clientMeta: null,
  note: null,
  teamNote: null,
  priceLabel: null,
  priceCents: PriceCents.ZERO,
  currency: Currency.EUR,
  tipLabel: null,
  tipCents: null,
  discounts: [],
  vouchers: [],
  resolution: null,
  bookingStatus: null,
  statusLabel: '',
  arrivedMinute: null,
  locationId: null,
  timeZone: null,
  chairId: null,
  chairName: 'Иван',
  chairTone: 0,
  neighbours: [
    { name: 'Петър', startMinute: at(660), endMinute: at(690), tone: 0 },
  ],
  rosterStartMinute: at(540),
  rosterEndMinute: at(1080),
  now: null,
  primaryVerb: null,
  overflowVerbs: [],
  acting: false,
  ...partial,
});

const frame = (start: number, end: number) => ({
  startMinute: at(start),
  endMinute: at(end),
});

const lunch = MinuteRange.of(
  MinuteOfDay.ofProven(780),
  EndMinute.ofProven(840),
);

describe('dropRouteOf — where a block dropped on the grid goes', () => {
  it('saves a move or a resize that lands clear, inside the shift', () => {
    expect(dropRouteOf(visit(), [], frame(630, 660))).toBe(DropRoute.Save);
    expect(dropRouteOf(visit(), [], frame(600, 645))).toBe(DropRoute.Save);
  });

  it('goes back down when nothing moved', () => {
    expect(dropRouteOf(visit(), [], frame(600, 630))).toBe(DropRoute.Stay);
  });

  it('asks the sheet when it runs into another visit', () => {
    expect(dropRouteOf(visit(), [], frame(645, 675))).toBe(DropRoute.Sheet);
  });

  it('asks the sheet when it runs into blocked time', () => {
    expect(dropRouteOf(visit(), [lunch], frame(770, 800))).toBe(
      DropRoute.Sheet,
    );
    // Touching the block's edge is not running into it.
    expect(dropRouteOf(visit(), [lunch], frame(750, 780))).toBe(DropRoute.Save);
  });

  it('asks the sheet when it leaves the shift', () => {
    expect(dropRouteOf(visit(), [], frame(1065, 1095))).toBe(DropRoute.Sheet);
  });

  it('saves a chair of a party like any other — its chairs keep times of their own', () => {
    const party = visit({
      peers: [
        {
          rowId: 'appt-1#niko',
          clientLabel: 'Синът на Стоян',
          chairName: 'Нико',
          chairTone: 1,
          timeLabel: '10:00 – 10:30',
        },
      ],
    });
    expect(dropRouteOf(party, [], frame(630, 660))).toBe(DropRoute.Save);
  });
});

describe('blockDropOf — blocked time dropped on the grid', () => {
  const day = unwrapOk(LocalDate.parse('2026-11-07'));
  const ivan = BarberId.of('ivan');
  const drop = (to: { startMinute: TrackMinute; endMinute: TrackMinute }) =>
    blockDropOf({
      barberId: ivan,
      localDate: day,
      from: frame(720, 780),
      to,
      others: [frame(960, 1020)],
      locationId: null,
    });

  it('reads its chair and day off its grid key, the chair taken whole', () => {
    expect(blockKeyOf('block:ivan:2026-11-07:720')).toEqual({
      barberId: ivan,
      localDate: day,
    });
    expect(blockKeyOf('block:a:b:2026-11-07:720')?.barberId).toBe('a:b');
    expect(blockKeyOf('appt-1#ivan')).toBeNull();
  });

  it('saves a move as one lift-and-write, its way back the same move reversed', () => {
    const moved = blockDropOf({
      barberId: ivan,
      localDate: day,
      from: frame(720, 780),
      to: frame(780, 840),
      others: [],
      locationId: LocationId.of('shop-1'),
    });
    expect(moved.route).toBe(DropRoute.Save);
    expect(moved.move?.lift?.range).toEqual({
      startMinutes: 720,
      endMinutes: 780,
    });
    expect(moved.move?.writes?.[0]?.ranges).toEqual([
      { startMinutes: 780, endMinutes: 840 },
    ]);
    expect(moved.back?.lift?.range).toEqual({
      startMinutes: 780,
      endMinutes: 840,
    });
  });

  it("may sit over a visit, never on the chair's other blocked time", () => {
    expect(drop(frame(990, 1050)).route).toBe(DropRoute.Refuse);
    // Touching its edge is not running into it.
    expect(drop(frame(900, 960)).route).toBe(DropRoute.Save);
  });

  it('goes back down when nothing moved', () => {
    expect(drop(frame(720, 780)).route).toBe(DropRoute.Stay);
  });

  it('with no shop to file it at, hands the store its refusal by name', () => {
    expect(drop(frame(780, 840)).move).toEqual({
      lift: null,
      writes: null,
      chairWithoutHome: ivan,
    });
  });
});
