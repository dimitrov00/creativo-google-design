import {
  CompositionKind,
  type ServiceComposition,
} from '../components/service-composition.data';
import type { Service } from '../entities/service.entity';
import type { ServiceId } from '../primitives/ids.primitive';

/**
 * What the conflict rule reads of a service — its id, the conflicts its
 * author wrote, and what it is made of (the flat `compositionKind` slice). A
 * whole `Service` passes straight in.
 */
export type ConflictService = Pick<Service, 'id' | 'conflictsWith'> &
  ServiceComposition;

/**
 * The selectability tags — the ONLY source of these strings, named after the
 * field they type (`selectability`; was `ServiceSelectabilityKind`).
 */
export const Selectability = {
  Selectable: 'SELECTABLE',
  Blocked: 'BLOCKED',
} as const;
export type Selectability = (typeof Selectability)[keyof typeof Selectability];

/**
 * Whether a candidate service can join one seat's selection, and if not, what
 * stands in the way (`service-conflicts.ts:9-11`). `BLOCKED` always names the
 * blockers — an unexplained lock is the failure mode this rule exists to
 * prevent.
 */
export type ServiceSelectability =
  | { readonly selectability: typeof Selectability.Selectable }
  | {
      readonly selectability: typeof Selectability.Blocked;
      readonly by: readonly ServiceId[];
    };

const SELECTABLE: ServiceSelectability = {
  selectability: Selectability.Selectable,
};

/** The ids a service occupies — itself plus, for a bundle, its members. */
function occupiedIds(service: ConflictService): readonly ServiceId[] {
  return service.compositionKind === CompositionKind.Bundle
    ? [service.id, ...service.bundleServiceIds]
    : [service.id];
}

/**
 * Everything a service actually puts in the chair: itself, plus a bundle's
 * members resolved against `catalog` (a member the catalogue does not hold is
 * skipped). This is what makes conflicts see THROUGH a bundle.
 */
function effectiveServices(
  service: ConflictService,
  catalog: readonly ConflictService[],
): readonly ConflictService[] {
  if (service.compositionKind !== CompositionKind.Bundle) return [service];
  const members: ConflictService[] = [service];
  for (let i = 0; i < service.bundleServiceIds.length; i++) {
    const memberId = service.bundleServiceIds[i] as ServiceId;
    for (let k = 0; k < catalog.length; k++) {
      const candidate = catalog[k] as ConflictService;
      if (candidate.id === memberId) {
        members.push(candidate);
        break;
      }
    }
  }
  return members;
}

function names(service: ConflictService, other: ServiceId): boolean {
  return service.conflictsWith.includes(other);
}

/**
 * ServiceConflictSystem — which services refuse to share one seat
 * (`service-conflicts.ts:68,112`). One implementation for the services step,
 * the bag, the commit's admission and the waitlist.
 */
export const ServiceConflictSystem = {
  /**
   * Do `a` and `b` refuse to share one seat? Three sources of truth,
   * combined here rather than in the data:
   *
   * 1. **Authored conflicts, normalised SYMMETRICALLY** — if EITHER names the
   *    other, they conflict (a half-authored pair must never be silently
   *    legal; it only shows up as a double-booked chair).
   * 2. **Bundle membership, DERIVED** — a bundle conflicts with its own
   *    members, and two bundles sharing a member conflict.
   * 3. **Conflicts INHERITED through membership** (needs `catalog`) — a
   *    bundle containing the classic cut conflicts with the fade too.
   *
   * A service never conflicts with itself: two lines of one service on a
   * seat is a legitimate booking.
   */
  servicesConflict(
    a: ConflictService,
    b: ConflictService,
    catalog: readonly ConflictService[],
  ): boolean {
    if (a.id === b.id) return false;

    // Rule 2, and two different bundles that share a member.
    const aIds = occupiedIds(a);
    const bIds = occupiedIds(b);
    for (let i = 0; i < aIds.length; i++) {
      if (bIds.includes(aIds[i] as ServiceId)) return true;
    }

    // Rules 1 and 3 — every real service each side puts in the chair, crossed.
    const aServices = effectiveServices(a, catalog);
    const bServices = effectiveServices(b, catalog);
    for (let i = 0; i < aServices.length; i++) {
      const left = aServices[i] as ConflictService;
      for (let k = 0; k < bServices.length; k++) {
        const right = bServices[k] as ConflictService;
        if (left.id === right.id) continue;
        if (names(left, right.id) || names(right, left.id)) return true;
      }
    }
    return false;
  },

  /**
   * Which members of `selection` block `candidate`, in selection order —
   * empty when nothing does. The scope is ONE SEAT, never the whole visit:
   * a Father & Son bundle is legal when two guests each hold one of the
   * conflicting singles, and taking a single seat's selection is how the
   * signature enforces it.
   */
  conflictingWith(
    selection: readonly ConflictService[],
    candidate: ConflictService,
    catalog: readonly ConflictService[],
  ): readonly ServiceId[] {
    const by: ServiceId[] = [];
    for (let i = 0; i < selection.length; i++) {
      const selected = selection[i] as ConflictService;
      if (ServiceConflictSystem.servicesConflict(selected, candidate, catalog))
        by.push(selected.id);
    }
    return by;
  },

  /** `SELECTABLE`, or `BLOCKED` naming every blocker. */
  selectabilityFor(
    selection: readonly ConflictService[],
    candidate: ConflictService,
    catalog: readonly ConflictService[],
  ): ServiceSelectability {
    const by = ServiceConflictSystem.conflictingWith(
      selection,
      candidate,
      catalog,
    );
    return by.length === 0
      ? SELECTABLE
      : { selectability: Selectability.Blocked, by };
  },
} as const;
