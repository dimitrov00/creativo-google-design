import {
  type Actor,
  BarberOffering,
  type ServiceTerms,
  type VariantTerms,
  WriteOp,
  WriteProvenance,
} from '@core/components';
import {
  type BarberId,
  type OperationId,
  Result,
  type ServiceId,
  type UtcEpochMs,
} from '@core/primitives';
import { TeamError } from '@core/errors';
import { Collections, type Service } from '@core/entities';
import { AuditSystem } from './audit.system';
import { OfferingPriceSystem } from './offering-price.system';

/** A service whose `offerings` change, and the list to write. */
export type OfferingChange = {
  readonly serviceId: ServiceId;
  readonly offerings: readonly BarberOffering[];
};

/**
 * One offerings act on a barber, as its pipeline decided it: whose list,
 * the per-service changes, the colleague copied from (`null` for a typed
 * list), who did it and the act's name.
 */
export type OfferingsWrite = {
  readonly barberId: BarberId;
  readonly changes: readonly OfferingChange[];
  readonly copiedFromBarberId: BarberId | null;
  /** The caller, credited over their STORED roles (`Actor.forCaller`). */
  readonly actor: Actor;
  readonly nowUtcMs: UtcEpochMs;
  readonly operationId: OperationId;
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
   * performs: each named service gains or replaces their offering (the
   * entry's terms under this barber, parsed by the catalogue's own guard,
   * `BarberOffering.parse`, against the service's variants and currency),
   * and every other service loses it.
   *
   * Refused: a service named twice or terms the guard rejects
   * (`TEAM_INVALID_INPUT`, field `offerings`), a price in another currency
   * than the service's (field `currency`), an id that is no service
   * (`TEAM_SERVICE_UNKNOWN`).
   */
  plan(
    services: readonly Service[],
    barberId: BarberId,
    entries: readonly BarberOffering.Entry[],
  ): Result<readonly OfferingChange[], TeamError> {
    const byService = new Map<ServiceId, BarberOffering.Entry>();
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i] as BarberOffering.Entry;
      if (byService.has(entry.serviceId)) {
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
      // The guard reads the terms and overrides by name; the barber is the call's.
      const parsed = BarberOffering.parse(
        { ...entry, barberId },
        service.variants,
      );
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

  /**
   * The write plan of one offerings act (team onboarding D12): each changed
   * service's `offerings` updated at the root, stamped with the act
   * (`writeOperationId` — the governed trigger reads the stamp as "audited
   * in its own commit"), and ONE `TEAM_BARBER_OFFERINGS_CHANGED` row on the
   * barber under `hash(idBasis)`, which lands with the writes or not at
   * all. An act that changes no service plans NOTHING — a save of what is
   * already there, and the replay of an act that landed.
   */
  writesOf(
    write: OfferingsWrite,
    hash: (input: string) => string,
  ): readonly WriteOp[] {
    const { changes } = write;
    if (changes.length === 0) return [];
    const writes: WriteOp[] = [];
    const serviceIds: ServiceId[] = [];
    for (let i = 0; i < changes.length; i++) {
      const change = changes[i] as OfferingChange;
      serviceIds.push(change.serviceId);
      writes.push(
        WriteOp.update([Collections.Services, change.serviceId], {
          offerings: change.offerings,
          ...WriteProvenance.of(write.operationId),
        }),
      );
    }
    writes.push(
      ...AuditSystem.createsOf(
        [
          AuditSystem.planTeamOfferings(
            write.barberId,
            serviceIds,
            write.copiedFromBarberId,
            write.actor,
            write.nowUtcMs,
            write.operationId,
          ),
        ],
        hash,
      ),
    );
    return writes;
  },
} as const;
