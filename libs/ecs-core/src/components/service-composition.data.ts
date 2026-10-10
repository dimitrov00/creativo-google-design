import { ServiceId } from '../entities/service.entity';
import { CatalogError } from './catalog-errors.data';
import { Result } from './result.data';

/** The stored composition tags — the ONLY source of these strings. */
export const ServiceCompositionKind = {
  Single: 'single',
  Bundle: 'bundle',
} as const;
export type ServiceCompositionKind =
  (typeof ServiceCompositionKind)[keyof typeof ServiceCompositionKind];

/**
 * What a service is made of (`service.ts:48`): a `single` service, or a
 * `bundle` of other services. Discriminated so "a bundle without parts" is
 * unrepresentable — `includes` exists only on the bundle variant, and
 * {@link ServiceComposition.parse} refuses an empty one.
 *
 * Named *composition*, not "offering": on a service, `offerings` is the
 * per-barber pricing matrix, and one word cannot mean both.
 *
 * The bundle's key is the stored `includes` (`services.composition.includes`,
 * blueprint §3.4; the seed at `tools/seed-dev-catalog.mjs:490`) — the
 * component equals the stored map, so nothing is renamed on the way in.
 */
export type ServiceComposition =
  ServiceComposition.Single | ServiceComposition.Bundle;

export const ServiceComposition = {
  single(): ServiceComposition.Single {
    return { kind: ServiceCompositionKind.Single };
  },

  /** Trusted parts; validate untrusted input with {@link parse}. */
  bundle(includes: readonly ServiceId[]): ServiceComposition.Bundle {
    return { kind: ServiceCompositionKind.Bundle, includes };
  },

  isBundle(
    composition: ServiceComposition,
  ): composition is ServiceComposition.Bundle {
    return composition.kind === ServiceCompositionKind.Bundle;
  },

  /** The component services, in order — `[]` for a single service. */
  parts(composition: ServiceComposition): readonly ServiceId[] {
    return composition.kind === ServiceCompositionKind.Bundle
      ? composition.includes
      : [];
  },

  /**
   * The edge guard: a bundle must include at least one service
   * (`catalog.service.empty_bundle_includes`, reported alone), and each
   * included id must be non-blank (`catalog.id.empty`, one per blank id).
   * Ids are kept exactly as given.
   */
  parse(
    raw:
      | ServiceComposition.Single
      | {
          readonly kind: typeof ServiceCompositionKind.Bundle;
          readonly includes: readonly string[];
        },
  ): Result<ServiceComposition, readonly CatalogError[]> {
    if (raw.kind === ServiceCompositionKind.Single) {
      return Result.ok(ServiceComposition.single());
    }
    if (raw.includes.length === 0) {
      return Result.err([CatalogError.serviceEmptyBundleIncludes()]);
    }
    const errors: CatalogError[] = [];
    const includes: ServiceId[] = [];
    for (let i = 0; i < raw.includes.length; i++) {
      const id = raw.includes[i] as string;
      if (id.trim().length === 0)
        errors.push(CatalogError.idEmpty('ServiceId'));
      else includes.push(ServiceId.of(id));
    }
    return errors.length > 0
      ? Result.err(errors)
      : Result.ok(ServiceComposition.bundle(includes));
  },
} as const;

export namespace ServiceComposition {
  export type Single = {
    readonly kind: typeof ServiceCompositionKind.Single;
  };
  export type Bundle = {
    readonly kind: typeof ServiceCompositionKind.Bundle;
    /** The component services, in order — never empty. */
    readonly includes: readonly ServiceId[];
  };
}
