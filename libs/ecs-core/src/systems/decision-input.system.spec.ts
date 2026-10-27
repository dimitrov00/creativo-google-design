import { describe, expect, it } from 'vitest';
import { BlockKind, MinuteBlock } from '@core/components';
import type { BarberBusyDay } from '@core/entities';
import { BarberBusyDayId, BarberId, BusyKey } from '@core/primitives';
import {
  deepFreeze,
  endMinute,
  FIXTURE_NOW_UTC_MS,
  localDate,
  minute,
} from '@core/testing';
import { DecisionInputSystem } from './decision-input.system';

/* What a refused booking decision read (audit-hardening WS-4.2, RU-25):
 * the read busy days' keys, the block the refused start ran into, the
 * stored revision — flat facts of the public busy geometry. */

const IVAN = BarberId.of('barber-ivan');
const MARIA = BarberId.of('barber-maria');
const DAY = localDate('2026-11-03');
const NEXT_DAY = localDate('2026-11-04');

const block = (start: number, end: number, kind: BlockKind = BlockKind.Busy) =>
  MinuteBlock.of(minute(start), endMinute(end), kind);

const busyDay = (
  barberId: BarberId,
  day: typeof DAY,
  blocks: readonly MinuteBlock[],
): BarberBusyDay => ({
  id: BarberBusyDayId.of(BusyKey.of(barberId, day)),
  barberId,
  localDate: day,
  utcEpochMs: FIXTURE_NOW_UTC_MS,
  blocks,
});

const refusalAt = (barberId: BarberId, day: typeof DAY, start: number) => ({
  barberId,
  localDate: day,
  startMinutes: minute(start),
});

describe('DecisionInputSystem.slotFacts', () => {
  it('names every read busy day by its key, sorted', () => {
    const facts = DecisionInputSystem.slotFacts(
      [
        busyDay(MARIA, DAY, []),
        busyDay(IVAN, NEXT_DAY, []),
        busyDay(IVAN, DAY, []),
      ],
      null,
      null,
    );
    expect(facts.readBusyKeys).toEqual([
      BusyKey.of(IVAN, DAY),
      BusyKey.of(IVAN, NEXT_DAY),
      BusyKey.of(MARIA, DAY),
    ]);
  });

  it('finds the block holding the refused start on the refused barber’s day', () => {
    const facts = DecisionInputSystem.slotFacts(
      [
        busyDay(MARIA, DAY, [block(600, 660)]),
        busyDay(IVAN, DAY, [
          block(540, 570),
          block(600, 660, BlockKind.Padding),
        ]),
      ],
      refusalAt(IVAN, DAY, 630),
      7,
    );
    expect(facts).toEqual({
      readBusyKeys: [BusyKey.of(IVAN, DAY), BusyKey.of(MARIA, DAY)],
      collidingStartMinutes: 600,
      collidingEndMinutes: 660,
      readRevision: 7,
    });
  });

  it('else the next block after the start — the one the requested span runs into', () => {
    const facts = DecisionInputSystem.slotFacts(
      [busyDay(IVAN, DAY, [block(720, 780), block(660, 690), block(540, 570)])],
      refusalAt(IVAN, DAY, 630),
      null,
    );
    expect(facts.collidingStartMinutes).toBe(660);
    expect(facts.collidingEndMinutes).toBe(690);
  });

  it('treats spans as half-open: a block ending AT the start does not collide', () => {
    const facts = DecisionInputSystem.slotFacts(
      [busyDay(IVAN, DAY, [block(570, 600)])],
      refusalAt(IVAN, DAY, 600),
      null,
    );
    expect(facts.collidingStartMinutes).toBeNull();
    expect(facts.collidingEndMinutes).toBeNull();
  });

  it('boundary: no busy day read — no keys, no block', () => {
    expect(
      DecisionInputSystem.slotFacts([], refusalAt(IVAN, DAY, 600), 3),
    ).toEqual({
      readBusyKeys: [],
      collidingStartMinutes: null,
      collidingEndMinutes: null,
      readRevision: 3,
    });
  });

  it('boundary: the refused barber’s day was not read (another barber, another day)', () => {
    const facts = DecisionInputSystem.slotFacts(
      [
        busyDay(MARIA, DAY, [block(0, 1440)]),
        busyDay(IVAN, NEXT_DAY, [block(0, 1440)]),
      ],
      refusalAt(IVAN, DAY, 600),
      null,
    );
    expect(facts.collidingStartMinutes).toBeNull();
    expect(facts.collidingEndMinutes).toBeNull();
  });

  it('boundary: a refusal with no collision (a refused day with no blocks, or no refusal at all)', () => {
    const empty = DecisionInputSystem.slotFacts(
      [busyDay(IVAN, DAY, [])],
      refusalAt(IVAN, DAY, 600),
      null,
    );
    expect(empty.collidingStartMinutes).toBeNull();
    const none = DecisionInputSystem.slotFacts(
      [busyDay(IVAN, DAY, [block(600, 660)])],
      null,
      null,
    );
    expect(none.collidingStartMinutes).toBeNull();
    expect(none.collidingEndMinutes).toBeNull();
    expect(none.readBusyKeys).toEqual([BusyKey.of(IVAN, DAY)]);
  });

  it('boundary: minute 0 — the first block of the day', () => {
    const facts = DecisionInputSystem.slotFacts(
      [busyDay(IVAN, DAY, [block(30, 60), block(0, 15)])],
      refusalAt(IVAN, DAY, 0),
      null,
    );
    expect(facts.collidingStartMinutes).toBe(0);
    expect(facts.collidingEndMinutes).toBe(15);
  });

  it('boundary: minute 1439 — a block closing at midnight (1440) collides, one ending at 1439 does not', () => {
    const closing = DecisionInputSystem.slotFacts(
      [busyDay(IVAN, DAY, [block(1380, 1440)])],
      refusalAt(IVAN, DAY, 1439),
      null,
    );
    expect(closing.collidingStartMinutes).toBe(1380);
    expect(closing.collidingEndMinutes).toBe(1440);
    const before = DecisionInputSystem.slotFacts(
      [busyDay(IVAN, DAY, [block(1380, 1439)])],
      refusalAt(IVAN, DAY, 1439),
      null,
    );
    expect(before.collidingStartMinutes).toBeNull();
    expect(before.collidingEndMinutes).toBeNull();
  });

  it('passes the stored revision through, 0 included', () => {
    expect(DecisionInputSystem.slotFacts([], null, 0).readRevision).toBe(0);
    expect(
      DecisionInputSystem.slotFacts([], null, null).readRevision,
    ).toBeNull();
  });

  it('is pure: same input → same output, inputs untouched', () => {
    const days = deepFreeze([
      busyDay(MARIA, DAY, [block(600, 660)]),
      busyDay(IVAN, DAY, [block(720, 780), block(540, 600)]),
    ]);
    const refusal = deepFreeze(refusalAt(IVAN, DAY, 570));
    const once = DecisionInputSystem.slotFacts(days, refusal, 2);
    const twice = DecisionInputSystem.slotFacts(days, refusal, 2);
    expect(twice).toEqual(once);
    expect(days[0]?.barberId).toBe(MARIA);
    expect(days[1]?.blocks.map((b) => b.startMinutes)).toEqual([720, 540]);
  });
});
