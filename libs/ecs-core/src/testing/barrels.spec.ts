import { describe, expect, it } from 'vitest';
import * as components from '@core/components';
import * as entities from '@core/entities';
import * as pipelines from '@core/pipelines';
import * as ports from '@core/ports';
import * as primitives from '@core/primitives';
import * as systems from '@core/systems';

const tiers = { primitives, components, entities, ports, systems, pipelines };
const ecs = {
  ...primitives,
  ...components,
  ...entities,
  ...ports,
  ...systems,
  ...pipelines,
};

/**
 * The six tier barrels (Law 8) load as ONE module graph at run time — a
 * value-import cycle between the tiers would surface here as a
 * temporal-dead-zone error — and expose named exports only, each name from
 * exactly one tier.
 */
describe('@core/* tier barrels', () => {
  it('exports every name from exactly one tier', () => {
    const homes = new Map<string, string[]>();
    for (const [tier, barrel] of Object.entries(tiers)) {
      for (const name of Object.keys(barrel)) {
        homes.set(name, [...(homes.get(name) ?? []), tier]);
      }
    }
    const shared = [...homes].filter(([, found]) => found.length > 1);
    expect(shared).toEqual([]);
  });

  it('has no default export', () => {
    expect(Object.keys(ecs)).not.toContain('default');
  });

  it('exposes the companions of every layer, all defined', () => {
    const companions = {
      Result: ecs.Result,
      Money: ecs.Money,
      MinuteRange: ecs.MinuteRange,
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
      // The flatten-pass primitives and their companions (flatten-spec §1).
      LocalDate: ecs.LocalDate,
      MinuteOfDay: ecs.MinuteOfDay,
      EndMinute: ecs.EndMinute,
      DurationMinutes: ecs.DurationMinutes,
      MinuteCount: ecs.MinuteCount,
      MinuteDelta: ecs.MinuteDelta,
      UtcEpochMs: ecs.UtcEpochMs,
      PriceCents: ecs.PriceCents,
      Currency: ecs.Currency,
      CustomerId: ecs.CustomerId,
      AuditResourceId: ecs.AuditResourceId,
      SeatKeyText: ecs.SeatKeyText,
      Latitude: ecs.Latitude,
      EpochSeconds: ecs.EpochSeconds,
      PrimitiveError: ecs.PrimitiveError,
      ShopNow: ecs.ShopNow,
      WallTime: ecs.WallTime,
      DateRange: ecs.DateRange,
      WriteAction: ecs.WriteAction,
      defect: ecs.defect,
    };
    for (const [name, companion] of Object.entries(companions)) {
      expect(companion, name).toBeDefined();
    }
  });

  it('exports each flatten-pass name once, from its one home', () => {
    // DateRange is the flat local-date span; TenantId and BusyKey are the
    // primitives (flatten-spec §1.5) — no pre-flatten twin is left.
    expect(ecs.DateRange.of('a' as never, 'b' as never)).toEqual({
      fromLocalDate: 'a',
      toLocalDate: 'b',
    });
    expect(ecs.TenantId.parse('').ok).toBe(false);
    expect(
      Object.keys(
        ecs.BusyKey.split(ecs.BusyKey.parse('b__2026-10-07') ?? ('' as never)),
      ),
    ).toEqual(['barberId', 'localDate']);
    for (const gone of [
      'DayKey',
      'DayOffset',
      'ZonedInstant',
      'TimeInterval',
      'CurrencyCode',
      'WriteKind',
      'LegacyTimeError',
      'BookingCommitErrorCode',
    ]) {
      expect(Object.keys(ecs)).not.toContain(gone);
    }
  });

  it('every exported value is defined (no export read before its module ran)', () => {
    const undefinedExports = Object.entries(ecs)
      .filter(([, value]) => value === undefined)
      .map(([name]) => name);
    expect(undefinedExports).toEqual([]);
  });
});
