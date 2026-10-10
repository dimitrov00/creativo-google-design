import { describe, expect, it } from 'vitest';
import * as ecs from './index';

/**
 * The barrel loads as ONE module graph at run time — a value-import cycle
 * between components, entities, systems and the collection registry would
 * surface here as a temporal-dead-zone error — and exposes named exports
 * only.
 */
describe('@creativo/ecs-core barrel', () => {
  it('has no default export', () => {
    expect(Object.keys(ecs)).not.toContain('default');
  });

  it('exposes the companions of every layer, all defined', () => {
    const companions = {
      Result: ecs.Result,
      Money: ecs.Money,
      TimeInterval: ecs.TimeInterval,
      BookingStatus: ecs.BookingStatus,
      WriteOp: ecs.WriteOp,
      AppointmentId: ecs.AppointmentId,
      UserId: ecs.UserId,
      ZonedTimeSystem: ecs.ZonedTimeSystem,
      PhoneSystem: ecs.PhoneSystem,
      IntervalSetSystem: ecs.IntervalSetSystem,
      RosterSystem: ecs.RosterSystem,
      AvailabilitySystem: ecs.AvailabilitySystem,
      Collections: ecs.Collections,
    };
    for (const [name, companion] of Object.entries(companions)) {
      expect(companion, name).toBeDefined();
    }
  });

  it('every exported value is defined (no export read before its module ran)', () => {
    const undefinedExports = Object.entries(ecs)
      .filter(([, value]) => value === undefined)
      .map(([name]) => name);
    expect(undefinedExports).toEqual([]);
  });
});
