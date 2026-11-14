import { describe, expect, it } from 'vitest';
import { GridEvent as GridEventTag } from '@core/components';
import { BarberId, DurationMinutes, LocalDate } from '@core/primitives';
import { trackMinute, unwrapOk } from '@core/testing';
import {
  NEW_VISIT_BLANKS,
  createFromSlot,
  createChairOf,
  movableIdsOf,
  readOnlyIdsOf,
  slotTimeLabel,
} from './create-from';

const SATURDAY = unwrapOk(LocalDate.parse('2026-11-07'));
const HALF_HOUR = unwrapOk(DurationMinutes.of(30));
const IVAN = BarberId.of('ivan');

describe('createFromSlot — a grid slot as a create’s origin', () => {
  it('reads a CHAIR column as its chair, on the shown day', () => {
    const from = createFromSlot(
      { columnId: 'niko', startMinute: trackMinute(780) },
      'chairs',
      SATURDAY,
      IVAN,
      HALF_HOUR,
    );
    expect(from).toEqual({
      barberId: 'niko',
      dayKey: SATURDAY,
      bookableFromMinutes: 780,
      openFromMinutes: 780,
      endMinutes: 810,
      minutes: 30,
    });
  });

  it('reads a DATE column as its day, on the chair a create aims at', () => {
    const from = createFromSlot(
      { columnId: '2026-11-08', startMinute: trackMinute(600) },
      'dates',
      SATURDAY,
      IVAN,
      HALF_HOUR,
    );
    expect(from?.dayKey).toBe('2026-11-08');
    expect(from?.barberId).toBe('ivan');
  });

  it('refuses a date column with no chair to seat it, or a column naming no day', () => {
    const slot = { columnId: '2026-11-08', startMinute: trackMinute(600) };
    expect(createFromSlot(slot, 'dates', SATURDAY, null, HALF_HOUR)).toBeNull();
    expect(
      createFromSlot(
        { columnId: 'ivan', startMinute: trackMinute(600) },
        'dates',
        SATURDAY,
        IVAN,
        HALF_HOUR,
      ),
    ).toBeNull();
  });

  it('keeps the span inside the day', () => {
    const late = createFromSlot(
      { columnId: 'ivan', startMinute: trackMinute(1425) },
      'chairs',
      SATURDAY,
      IVAN,
      HALF_HOUR,
    );
    expect(late?.endMinutes).toBe(1440);
  });
});

describe('the grid’s create helpers', () => {
  it('words a slot as its clock range', () => {
    expect(
      slotTimeLabel({
        columnId: 'ivan',
        startMinute: trackMinute(630),
        endMinute: trackMinute(660),
      }),
    ).toBe('10:30 – 11:00');
  });

  it('lets a hold lift a visit whose story is not over, and blocked time not yet past', () => {
    const base = {
      startMinute: trackMinute(600),
      endMinute: trackMinute(630),
      title: '',
      detail: null,
      attribution: null,
      bookingStatus: null,
      past: false,
      accessibleName: '',
      statusIcon: null,
      partyLabel: null,
      barberTone: null,
    };
    const columns: Parameters<typeof movableIdsOf>[0] = [
      {
        id: 'ivan',
        title: '',
        detail: null,
        dayNumber: null,
        isToday: false,
        avatarSrc: null,
        open: [],
        events: [
          {
            ...base,
            id: 'live',
            gridEvent: GridEventTag.Visit,
            terminal: false,
          },
          {
            ...base,
            id: 'done',
            gridEvent: GridEventTag.Visit,
            terminal: true,
          },
          {
            ...base,
            id: 'break',
            gridEvent: GridEventTag.Block,
            terminal: false,
          },
          {
            ...base,
            id: 'old-break',
            gridEvent: GridEventTag.Block,
            terminal: false,
            past: true,
          },
        ],
      },
    ];
    const everything = (): boolean => true;
    // A break moves like a visit (owner, 2026-11-06); one already past does not.
    expect([...movableIdsOf(columns, everything)]).toEqual(['live', 'break']);

    // A colleague's blocked time stays where it is (staff permissions P8):
    // the gate is asked by id, and a visit is never its to refuse.
    const notTheBreak = (id: string): boolean => id !== 'break';
    expect([...movableIdsOf(columns, notTheBreak)]).toEqual(['live']);
    // …and is drawn as unavailable — past or not, a block the person may
    // not change is read-only; a visit never is.
    expect([...readOnlyIdsOf(columns, notTheBreak)]).toEqual(['break']);
    expect([...readOnlyIdsOf(columns, () => false)]).toEqual([
      'break',
      'old-break',
    ]);
    expect([...readOnlyIdsOf(columns, everything)]).toEqual([]);
  });

  it('aims a create at the scoped chair, else the first working lane, else the first chair — the last fallback is the door', () => {
    const NIKO = BarberId.of('niko');
    const chairs = [{ id: IVAN }, { id: NIKO }];
    const lanes = [{ barberId: NIKO }];
    expect(createChairOf(NIKO, chairs, lanes)).toBe(NIKO);
    // Nobody scoped: the first working lane.
    expect(createChairOf(null, chairs, lanes)).toBe(NIKO);
    // A scope that is no chair of the roster is not aimed at.
    expect(createChairOf(BarberId.of('gone'), chairs, lanes)).toBe(NIKO);
    // A day everyone is off still opens: the first chair of the roster.
    expect(createChairOf(null, chairs, [])).toBe(IVAN);
    expect(createChairOf(null, [], [])).toBeNull();
  });

  it('starts a new visit with nothing booked, priced or decided', () => {
    expect(NEW_VISIT_BLANKS).toMatchObject({
      appointmentId: null,
      bookingStatus: null,
      priceCents: null,
      discounts: [],
      primaryVerb: null,
    });
  });
});
