import { ServiceId as EcsServiceId } from '@core/primitives';
import { ServiceComposition as EcsServiceComposition } from '@core/components';
import { type ConflictService, ServiceConflictSystem } from '@core/systems';
import { ServiceId } from './ids';
import { Service } from './service';

/**
 * Whether a candidate service can join a selection, and if not, what stands
 * in the way. `blocked` always names the blockers — an unexplained lock is
 * the failure mode this whole module exists to prevent.
 *
 * Phase 2 shim: the rule is `ServiceConflictSystem` in `@core/systems`;
 * this file keeps the legacy `Service`/`ServiceId` signatures for its callers.
 */
export type ServiceSelectability =
  | { readonly kind: 'selectable' }
  | { readonly kind: 'blocked'; readonly by: readonly ServiceId[] };

/**
 * Do `a` and `b` refuse to share one seat? Authored conflicts normalised
 * symmetrically, bundle membership derived, conflicts inherited through
 * membership when a `catalog` is given — `ServiceConflictSystem.servicesConflict`.
 * A service never conflicts with itself.
 */
export function servicesConflict(
  a: Service,
  b: Service,
  catalog: readonly Service[] = [],
): boolean {
  return ServiceConflictSystem.servicesConflict(
    toConflictService(a),
    toConflictService(b),
    catalog.map(toConflictService),
  );
}

/**
 * Which members of `selection` block `candidate`. Empty ⇒ nothing does.
 * **Scope is ONE SEAT, never the whole appointment** (v2's ruling).
 */
export function conflictingWith(
  selection: readonly Service[],
  candidate: Service,
  catalog: readonly Service[] = [],
): readonly ServiceId[] {
  const blocked = ServiceConflictSystem.conflictingWith(
    selection.map(toConflictService),
    toConflictService(candidate),
    catalog.map(toConflictService),
  );
  return toLegacyIds(selection, blocked);
}

export function selectabilityFor(
  selection: readonly Service[],
  candidate: Service,
  catalog: readonly Service[] = [],
): ServiceSelectability {
  const by = conflictingWith(selection, candidate, catalog);
  return by.length === 0 ? { kind: 'selectable' } : { kind: 'blocked', by };
}

/* ── Converters between the legacy aggregate and the ecs-core struct ────── */

function toConflictService(service: Service): ConflictService {
  const composition = service.composition;
  return {
    id: EcsServiceId.of(service.id.value),
    conflictsWith: service.conflictsWith.map((id) => EcsServiceId.of(id.value)),
    // The composition is the flat `compositionKind` slice at the root.
    ...(composition.kind === 'bundle'
      ? EcsServiceComposition.bundle(
          composition.includes.map((id) => EcsServiceId.of(id.value)),
        )
      : EcsServiceComposition.single()),
  };
}

/**
 * The system's blockers (a subsequence of `selection`, in order) → the
 * selection's own legacy id objects.
 */
function toLegacyIds(
  selection: readonly Service[],
  blocked: readonly EcsServiceId[],
): readonly ServiceId[] {
  const ids: ServiceId[] = [];
  let next = 0;
  for (const selected of selection) {
    if (selected.id.value === blocked.at(next)) {
      ids.push(selected.id);
      next++;
    }
  }
  return ids;
}
