import { describe, expect, it } from 'vitest';
import { BlockKind, type ChairTime, MinuteBlock } from '@core/components';
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
 * the read busy days' keys, the taken span holding the refused sold start
 * (the chairs the decision handed back cut out), the stored revision —
 * flat facts of the public busy geometry. */

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

/** A chair the decision was handed back (a moved or edited visit's own). */
const chair = (barberId: BarberId, start: number, end: number): ChairTime => ({
  barberId,
  startMinutes: minute(start),
  endMinutes: endMinute(end),
});

/** A new booking hands no chair back. */
const NONE: readonly ChairTime[] = [];

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
      NONE,
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
      NONE,
    );
    expect(facts).toEqual({
      readBusyKeys: [BusyKey.of(IVAN, DAY), BusyKey.of(MARIA, DAY)],
      collidingStartMinutes: 600,
      collidingEndMinutes: 660,
      readRevision: 7,
    });
  });

  it('never names a later block: a refusal through a setup pad or the turnaround names none (review round 1)', () => {
    // A seat sold at 10:00 whose setup pad (or the barber's turnaround)
    // reaches back into 9:40–9:55 is refused by THAT block; the harmless
    // 11:40–12:10 block must not be named in its place.
    const facts = DecisionInputSystem.slotFacts(
      [busyDay(IVAN, DAY, [block(700, 730), block(580, 595)])],
      refusalAt(IVAN, DAY, 600),
      null,
      NONE,
    );
    expect(facts.collidingStartMinutes).toBeNull();
    expect(facts.collidingEndMinutes).toBeNull();
    // The same with the stored order sorted and a block ENDING at the start.
    const raced = DecisionInputSystem.slotFacts(
      [busyDay(IVAN, DAY, [block(540, 600), block(700, 730)])],
      refusalAt(IVAN, DAY, 600),
      null,
      NONE,
    );
    expect(raced.collidingStartMinutes).toBeNull();
    expect(raced.collidingEndMinutes).toBeNull();
  });

  it('a roster-window or past-midnight refusal names no block, a later one included', () => {
    const facts = DecisionInputSystem.slotFacts(
      [busyDay(IVAN, DAY, [block(700, 730)])],
      refusalAt(IVAN, DAY, 600),
      null,
      NONE,
    );
    expect(facts).toEqual({
      readBusyKeys: [BusyKey.of(IVAN, DAY)],
      collidingStartMinutes: null,
      collidingEndMinutes: null,
      readRevision: null,
    });
  });

  it('cuts out the chairs the decision was handed back: the visit’s own block is never named', () => {
    const days = [busyDay(IVAN, DAY, [block(600, 630), block(630, 660)])];
    const release = [chair(IVAN, 600, 630)];
    // The sold start 10:00 lies only in the visit's own, released chair.
    const own = DecisionInputSystem.slotFacts(
      days,
      refusalAt(IVAN, DAY, 600),
      4,
      release,
    );
    expect(own.collidingStartMinutes).toBeNull();
    expect(own.collidingEndMinutes).toBeNull();
    // A start the rest of the day holds names what is left of it.
    const rival = DecisionInputSystem.slotFacts(
      days,
      refusalAt(IVAN, DAY, 640),
      4,
      release,
    );
    expect(rival.collidingStartMinutes).toBe(630);
    expect(rival.collidingEndMinutes).toBe(660);
    // The projection's merged block (touching chairs stored as one span)
    // is cut the same way.
    const merged = DecisionInputSystem.slotFacts(
      [busyDay(IVAN, DAY, [block(600, 660)])],
      refusalAt(IVAN, DAY, 610),
      4,
      release,
    );
    expect(merged.collidingStartMinutes).toBeNull();
    expect(merged.collidingEndMinutes).toBeNull();
  });

  it('another barber’s released chair does not hide the refused barber’s block', () => {
    const facts = DecisionInputSystem.slotFacts(
      [busyDay(IVAN, DAY, [block(600, 660)])],
      refusalAt(IVAN, DAY, 600),
      null,
      [chair(MARIA, 600, 660)],
    );
    expect(facts.collidingStartMinutes).toBe(600);
    expect(facts.collidingEndMinutes).toBe(660);
  });

  it('treats spans as half-open: a block ending AT the start does not collide', () => {
    const facts = DecisionInputSystem.slotFacts(
      [busyDay(IVAN, DAY, [block(570, 600)])],
      refusalAt(IVAN, DAY, 600),
      null,
      NONE,
    );
    expect(facts.collidingStartMinutes).toBeNull();
    expect(facts.collidingEndMinutes).toBeNull();
  });

  it('boundary: no busy day read — no keys, no block', () => {
    expect(
      DecisionInputSystem.slotFacts([], refusalAt(IVAN, DAY, 600), 3, NONE),
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
      NONE,
    );
    expect(facts.collidingStartMinutes).toBeNull();
    expect(facts.collidingEndMinutes).toBeNull();
  });

  it('boundary: a refusal with no collision (a refused day with no blocks, or no refusal at all)', () => {
    const empty = DecisionInputSystem.slotFacts(
      [busyDay(IVAN, DAY, [])],
      refusalAt(IVAN, DAY, 600),
      null,
      NONE,
    );
    expect(empty.collidingStartMinutes).toBeNull();
    const none = DecisionInputSystem.slotFacts(
      [busyDay(IVAN, DAY, [block(600, 660)])],
      null,
      null,
      NONE,
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
      NONE,
    );
    expect(facts.collidingStartMinutes).toBe(0);
    expect(facts.collidingEndMinutes).toBe(15);
  });

  it('boundary: minute 1439 — a block closing at midnight (1440) collides, one ending at 1439 does not', () => {
    const closing = DecisionInputSystem.slotFacts(
      [busyDay(IVAN, DAY, [block(1380, 1440)])],
      refusalAt(IVAN, DAY, 1439),
      null,
      NONE,
    );
    expect(closing.collidingStartMinutes).toBe(1380);
    expect(closing.collidingEndMinutes).toBe(1440);
    const before = DecisionInputSystem.slotFacts(
      [busyDay(IVAN, DAY, [block(1380, 1439)])],
      refusalAt(IVAN, DAY, 1439),
      null,
      NONE,
    );
    expect(before.collidingStartMinutes).toBeNull();
    expect(before.collidingEndMinutes).toBeNull();
  });

  it('passes the stored revision through, 0 included', () => {
    expect(DecisionInputSystem.slotFacts([], null, 0, NONE).readRevision).toBe(
      0,
    );
    expect(
      DecisionInputSystem.slotFacts([], null, null, NONE).readRevision,
    ).toBeNull();
  });

  it('is pure: same input → same output, inputs untouched', () => {
    const days = deepFreeze([
      busyDay(MARIA, DAY, [block(600, 660)]),
      busyDay(IVAN, DAY, [block(720, 780), block(540, 600)]),
    ]);
    const refusal = deepFreeze(refusalAt(IVAN, DAY, 570));
    const release = deepFreeze([chair(IVAN, 720, 750), chair(MARIA, 600, 630)]);
    const once = DecisionInputSystem.slotFacts(days, refusal, 2, release);
    const twice = DecisionInputSystem.slotFacts(days, refusal, 2, release);
    expect(twice).toEqual(once);
    expect(once.collidingStartMinutes).toBe(540);
    expect(once.collidingEndMinutes).toBe(600);
    expect(days[0]?.barberId).toBe(MARIA);
    expect(days[1]?.blocks.map((b) => b.startMinutes)).toEqual([720, 540]);
    expect(release.map((each) => each.startMinutes)).toEqual([720, 600]);
  });
});
