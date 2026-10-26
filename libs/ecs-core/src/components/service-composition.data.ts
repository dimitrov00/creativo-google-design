import type { ServiceId } from '@core/primitives';

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
 * unrepresentable — `bundleServiceIds` exists only on the bundle variant.
 * No authoring edge exists to guard (OR-22 deleted the producer-less
 * `parse` with its empty-bundle refusal).
 *
 * Named *composition*, not "offering": on a service, `offerings` is the
 * per-barber pricing matrix, and one word cannot mean both. (Until the
 * booking-core flip the stored document kept the nested `composition:
 * { kind, includes } | null`, which the legacy shim converted.)
 */
export type ServiceComposition =
  | ServiceComposition.Single
  | ServiceComposition.Bundle
  | ServiceComposition.Unspecified;

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

  /** Trusted parts, in order. */
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

  /**
   * The composition a service DRAWS as — a bundle, or a single service. An
   * unspecified composition (the author never said: `composition: null` as
   * authored) draws as a single service, as it always did
   * (`catalog.presenter.ts`'s `serviceToVm`).
   */
  drawnKind(
    kind: CompositionKind,
  ): typeof CompositionKind.Single | typeof CompositionKind.Bundle {
    return kind === CompositionKind.Bundle
      ? CompositionKind.Bundle
      : CompositionKind.Single;
  },

  /** The component services, in order — `[]` for anything but a bundle. */
  parts(composition: ServiceComposition): readonly ServiceId[] {
    return composition.compositionKind === CompositionKind.Bundle
      ? composition.bundleServiceIds
      : [];
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
