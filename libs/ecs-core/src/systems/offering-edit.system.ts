import {
  BarberOffering,
  type ServiceTerms,
  type VariantTerms,
} from '@core/components';
import { type BarberId, Result, type ServiceId } from '@core/primitives';
import { TeamError } from '@core/errors';
import type { Service } from '@core/entities';
import { OfferingPriceSystem } from './offering-price.system';

/** One service a barber performs, at the terms the editor typed. */
export type OfferingEntry = {
  readonly serviceId: ServiceId;
  /** The offering as authored; its `barberId` is the barber being edited. */
  readonly offering: BarberOffering.Input;
};

/** A service whose `offerings` change, and the list to write. */
export type OfferingChange = {
  readonly serviceId: ServiceId;
  readonly offerings: readonly BarberOffering[];
};

function sameTerms(a: ServiceTerms, b: ServiceTerms): boolean {
  return (
    a.priceCents === b.priceCents &&
    a.currency === b.currency &&
    a.durationMinutes === b.durationMinutes &&
    a.setupMinutes === b.setupMinutes &&
    a.cleanupMinutes === b.cleanupMinutes
  );
}

/** Do two offerings of one barber charge and take the same, variant by variant? */
function sameOffering(a: BarberOffering, b: BarberOffering): boolean {
  if (!sameTerms(a, b) || a.overrides.length !== b.overrides.length) {
    return false;
  }
  for (let i = 0; i < a.overrides.length; i++) {
    const left = a.overrides[i] as VariantTerms;
    const right = b.overrides[i] as VariantTerms;
    if (left.variantId !== right.variantId || !sameTerms(left, right)) {
      return false;
    }
  }
  return true;
}

/** `offerings` with `barberId`'s entry replaced in place, appended when new, or dropped (`null`). */
function withOffering(
  offerings: readonly BarberOffering[],
  barberId: BarberId,
  next: BarberOffering | null,
): readonly BarberOffering[] {
  const out: BarberOffering[] = [];
  let placed = false;
  for (let i = 0; i < offerings.length; i++) {
    const offering = offerings[i] as BarberOffering;
    if (offering.barberId !== barberId) out.push(offering);
    else if (next !== null) {
      out.push(next);
      placed = true;
    }
  }
  if (next !== null && !placed) out.push(next);
  return out;
}

/**
 * OfferingEditSystem — a barber's services and prices, edited as ONE list
 * (team onboarding D5, D6). The pricing matrix lives on each service
 * (`Service.offerings`), so the editor's save is a set of per-service
 * changes; only the services whose list really changes are answered, so a
 * save that changes one price writes one document.
 *
 * A service left with no performer is everyone's at its own terms — the
 * catalogue's standing rule (`BarberBookabilitySystem.performs`).
 */
export const OfferingEditSystem = {
  /**
   * The changes that make `entries` the COMPLETE list of what `barberId`
   * performs: each named service gains or replaces their offering (parsed
   * by the catalogue's own guard, `BarberOffering.parse`, against the
   * service's variants and currency), and every other service loses it.
   *
   * Refused: a service named twice, an offering authored for another
   * barber or one the guard rejects (`TEAM_INVALID_INPUT`, field
   * `offerings`), a price in another currency than the service's (field
   * `currency`), an id that is no service (`TEAM_SERVICE_UNKNOWN`).
   */
  plan(
    services: readonly Service[],
    barberId: BarberId,
    entries: readonly OfferingEntry[],
  ): Result<readonly OfferingChange[], TeamError> {
    const byService = new Map<ServiceId, OfferingEntry>();
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i] as OfferingEntry;
      if (
        byService.has(entry.serviceId) ||
        entry.offering.barberId !== barberId
      ) {
        return Result.err(TeamError.invalidInput('offerings'));
      }
      byService.set(entry.serviceId, entry);
    }
    const changes: OfferingChange[] = [];
    let matched = 0;
    for (let i = 0; i < services.length; i++) {
      const service = services[i] as Service;
      const entry = byService.get(service.id);
      const stored = OfferingPriceSystem.offeringFor(service, barberId);
      if (entry === undefined) {
        if (stored !== null) {
          changes.push({
            serviceId: service.id,
            offerings: withOffering(service.offerings, barberId, null),
          });
        }
        continue;
      }
      matched++;
      const parsed = BarberOffering.parse(entry.offering, service.variants);
      if (!parsed.ok) return Result.err(TeamError.invalidInput('offerings'));
      if (BarberOffering.mixedCurrency(service, [parsed.value]) !== null) {
        return Result.err(TeamError.invalidInput('currency'));
      }
      if (stored !== null && sameOffering(stored, parsed.value)) continue;
      changes.push({
        serviceId: service.id,
        offerings: withOffering(service.offerings, barberId, parsed.value),
      });
    }
    if (matched < byService.size) {
      for (const serviceId of byService.keys()) {
        let known = false;
        for (let i = 0; i < services.length; i++) {
          if ((services[i] as Service).id === serviceId) {
            known = true;
            break;
          }
        }
        if (!known) return Result.err(TeamError.serviceUnknown(serviceId));
      }
    }
    return Result.ok(changes);
  },

  /**
   * «Копирай цените от» — the changes that give `toBarberId` the same
   * terms as `fromBarberId` on every service the latter performs: a
   * one-time snapshot (later changes to the source do not follow), a
   * service `toBarberId` already performs at those very terms unchanged,
   * and what `toBarberId` performs that the source does not left alone.
   */
  copied(
    services: readonly Service[],
    fromBarberId: BarberId,
    toBarberId: BarberId,
  ): readonly OfferingChange[] {
    const changes: OfferingChange[] = [];
    if (fromBarberId === toBarberId) return changes;
    for (let i = 0; i < services.length; i++) {
      const service = services[i] as Service;
      const source = OfferingPriceSystem.offeringFor(service, fromBarberId);
      if (source === null) continue;
      const copy: BarberOffering = { ...source, barberId: toBarberId };
      const stored = OfferingPriceSystem.offeringFor(service, toBarberId);
      if (stored !== null && sameOffering(stored, copy)) continue;
      changes.push({
        serviceId: service.id,
        offerings: withOffering(service.offerings, toBarberId, copy),
      });
    }
    return changes;
  },
} as const;
