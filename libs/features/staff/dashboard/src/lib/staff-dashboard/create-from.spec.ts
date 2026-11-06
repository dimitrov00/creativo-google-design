import { describe, expect, it } from 'vitest';
import { GridEvent as GridEventTag } from '@core/components';
import { BarberId, DurationMinutes, LocalDate } from '@core/primitives';
import { trackMinute, unwrapOk } from '@core/testing';
import {
  NEW_VISIT_BLANKS,
  createFromSlot,
  movableIdsOf,
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

  it('lets a hold lift only visits whose story is not over', () => {
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
    const ids = movableIdsOf([
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
        ],
      },
    ]);
    expect([...ids]).toEqual(['live']);
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
