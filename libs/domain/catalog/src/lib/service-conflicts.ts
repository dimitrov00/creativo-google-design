import { ServiceId } from './ids';
import { Service } from './service';

/**
 * Whether a candidate service can join a selection, and if not, what stands
 * in the way. `blocked` always names the blockers — an unexplained lock is
 * the failure mode this whole module exists to prevent.
 */
export type ServiceSelectability =
  | { readonly kind: 'selectable' }
  | { readonly kind: 'blocked'; readonly by: readonly ServiceId[] };

/**
 * Everything a service actually puts in the chair: itself, plus a bundle's
 * members. This is what makes conflicts see THROUGH a bundle rather than
 * only at it.
 *
 * `catalog` is optional so the shallow rule still works without one (a
 * bundle vs its own member is decidable from `composition` alone). Given a
 * catalog, members resolve to real services and their authored conflicts
 * come into play too.
 */
function effectiveServices(
  service: Service,
  catalog: readonly Service[],
): readonly Service[] {
  if (service.composition.kind !== 'bundle') return [service];
  const members = service.composition.includes.flatMap((memberId) => {
    const member = catalog.find((candidate) => candidate.id.equals(memberId));
    return member ? [member] : [];
  });
  return [service, ...members];
}

/** The ids a service occupies — itself plus, for a bundle, its members. */
function occupiedIds(service: Service): readonly ServiceId[] {
  return service.composition.kind === 'bundle'
    ? [service.id, ...service.composition.includes]
    : [service.id];
}

/**
 * Do `a` and `b` refuse to share one seat?
 *
 * Three sources of truth, combined here rather than in the data:
 *
 * 1. **Authored conflicts, normalised SYMMETRICALLY.** `Service.conflictsWith`
 *    is a one-way list, so a catalog manager who writes "the fade replaces
 *    the classic cut" should not also have to write the mirror image. If
 *    EITHER names the other, they conflict. Requiring both directions makes
 *    a half-authored pair silently legal — the worst kind of catalog bug,
 *    because it only shows up as a double-booked chair.
 * 2. **Bundle membership, DERIVED.** A bundle already contains its members,
 *    so "Full care" plus "Beard trim" charges twice for one beard. This is
 *    a fact about `composition`, never hand-authored: a bundle's `includes`
 *    is the only place it can be stated without going stale the moment the
 *    bundle is edited.
 * 3. **Conflicts INHERITED through membership** (needs `catalog`). If the
 *    classic cut conflicts with the fade, then a bundle CONTAINING the
 *    classic cut conflicts with the fade too — otherwise you can book two
 *    haircuts by hiding one inside a bundle. Found by exercising the rule
 *    against real seeded data, not in theory.
 *
 * A service never conflicts with itself — two lines of the same service on
 * one seat is a legitimate booking (a double appointment), and the cart
 * already distinguishes them by `CartLineId`.
 */
export function servicesConflict(
  a: Service,
  b: Service,
  catalog: readonly Service[] = [],
): boolean {
  if (a.id.equals(b.id)) return false;

  // Rule 2, and two different bundles that share a member.
  const aIds = occupiedIds(a);
  const bIds = occupiedIds(b);
  if (aIds.some((id) => bIds.some((other) => id.equals(other)))) return true;

  // Rules 1 and 3 — every real service each side puts in the chair, crossed.
  const aServices = effectiveServices(a, catalog);
  const bServices = effectiveServices(b, catalog);
  return aServices.some((left) =>
    bServices.some(
      (right) =>
        !left.id.equals(right.id) &&
        (left.conflictsWithService(right.id) ||
          right.conflictsWithService(left.id)),
    ),
  );
}

/**
 * Which members of `selection` block `candidate`. Empty ⇒ nothing does.
 *
 * **Scope is ONE SEAT, never the whole appointment** (v2's ruling): a
 * Father & Son bundle is perfectly legal when two different guests each
 * hold one of the conflicting single services. Taking a single seat's
 * selection is how that rule is enforced by the signature itself rather
 * than by every call site remembering it.
 */
export function conflictingWith(
  selection: readonly Service[],
  candidate: Service,
  catalog: readonly Service[] = [],
): readonly ServiceId[] {
  return selection
    .filter((selected) => servicesConflict(selected, candidate, catalog))
    .map((selected) => selected.id);
}

export function selectabilityFor(
  selection: readonly Service[],
  candidate: Service,
  catalog: readonly Service[] = [],
): ServiceSelectability {
  const by = conflictingWith(selection, candidate, catalog);
  return by.length === 0 ? { kind: 'selectable' } : { kind: 'blocked', by };
}
