import { ServiceId } from '../primitives/ids.primitive';
import { CatalogError } from './catalog-errors.data';
import { Result } from './result.data';

/**
 * The composition tags — the ONLY source of these strings, named after the
 * field they type (`compositionKind`; the union keeps the name
 * `ServiceComposition`, so the dictionary is `CompositionKind`, N15).
 * `UNSPECIFIED` is today's stored `composition: null` — a service whose
 * author never said.
 */
export const CompositionKind = {
  Single: 'SINGLE',
  Bundle: 'BUNDLE',
  Unspecified: 'UNSPECIFIED',
} as const;
export type CompositionKind =
  (typeof CompositionKind)[keyof typeof CompositionKind];

/**
 * What a service is made of (`service.ts:48`): a `SINGLE` service, a
 * `BUNDLE` of other services, or `UNSPECIFIED`. A flat variant SLICE (Law 6)
 * that `Service` intersects, discriminated so "a bundle without parts" is
 * unrepresentable — `bundleServiceIds` exists only on the bundle variant, and
 * {@link ServiceComposition.parse} refuses an empty one.
 *
 * Named *composition*, not "offering": on a service, `offerings` is the
 * per-barber pricing matrix, and one word cannot mean both. (The stored
 * document keeps the nested `composition: { kind, includes } | null` until
 * the booking-core flip; the shim converts.)
 */
export type ServiceComposition =
  | ServiceComposition.Single
  | ServiceComposition.Bundle
  | ServiceComposition.Unspecified;

/** A composition as authored, before its edge guard — the raw ids. */
export type ServiceCompositionInput =
  | ServiceComposition.Single
  | {
      readonly compositionKind: typeof CompositionKind.Bundle;
      readonly bundleServiceIds: readonly string[];
    };

const SINGLE: ServiceComposition.Single = {
  compositionKind: CompositionKind.Single,
};
const UNSPECIFIED: ServiceComposition.Unspecified = {
  compositionKind: CompositionKind.Unspecified,
};

export const ServiceComposition = {
  single(): ServiceComposition.Single {
    return SINGLE;
  },

  /** Trusted parts; validate untrusted input with {@link parse}. */
  bundle(bundleServiceIds: readonly ServiceId[]): ServiceComposition.Bundle {
    return { compositionKind: CompositionKind.Bundle, bundleServiceIds };
  },

  /** The author never said — today's stored `composition: null`. */
  unspecified(): ServiceComposition.Unspecified {
    return UNSPECIFIED;
  },

  isBundle(
    composition: ServiceComposition,
  ): composition is ServiceComposition.Bundle {
    return composition.compositionKind === CompositionKind.Bundle;
  },

  /** The component services, in order — `[]` for anything but a bundle. */
  parts(composition: ServiceComposition): readonly ServiceId[] {
    return composition.compositionKind === CompositionKind.Bundle
      ? composition.bundleServiceIds
      : [];
  },

  /**
   * The edge guard: a bundle must include at least one service
   * (`CATALOG_SERVICE_EMPTY_BUNDLE_INCLUDES`, reported alone), and each
   * included id must be non-blank (`CATALOG_ID_EMPTY`, one per blank id).
   * Ids are kept exactly as given.
   */
  parse(
    raw: ServiceCompositionInput,
  ): Result<ServiceComposition, readonly CatalogError[]> {
    if (raw.compositionKind === CompositionKind.Single) {
      return Result.ok(ServiceComposition.single());
    }
    if (raw.bundleServiceIds.length === 0) {
      return Result.err([CatalogError.serviceEmptyBundleIncludes()]);
    }
    const errors: CatalogError[] = [];
    const bundleServiceIds: ServiceId[] = [];
    for (let i = 0; i < raw.bundleServiceIds.length; i++) {
      const id = raw.bundleServiceIds[i] as string;
      if (id.trim().length === 0) {
        errors.push(CatalogError.idEmpty('ServiceId'));
      } else {
        bundleServiceIds.push(ServiceId.of(id));
      }
    }
    return errors.length > 0
      ? Result.err(errors)
      : Result.ok(ServiceComposition.bundle(bundleServiceIds));
  },
} as const;

export namespace ServiceComposition {
  export type Single = {
    readonly compositionKind: typeof CompositionKind.Single;
  };
  export type Bundle = {
    readonly compositionKind: typeof CompositionKind.Bundle;
    /** The component services, in order — never empty (was `includes`). */
    readonly bundleServiceIds: readonly ServiceId[];
  };
  export type Unspecified = {
    readonly compositionKind: typeof CompositionKind.Unspecified;
  };
}
