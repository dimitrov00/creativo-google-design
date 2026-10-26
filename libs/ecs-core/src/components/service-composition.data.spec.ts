import { describe, expect, it } from 'vitest';
import { ServiceId } from '@core/primitives';
import {
  CompositionKind,
  ServiceComposition,
} from './service-composition.data';

const CUT = ServiceId.of('svc-classic-cut');
const BEARD = ServiceId.of('svc-beard');

describe('ServiceComposition', () => {
  it('pins the composition tags — the stored null is UNSPECIFIED', () => {
    expect(CompositionKind).toEqual({
      Single: 'SINGLE',
      Bundle: 'BUNDLE',
      Unspecified: 'UNSPECIFIED',
    });
  });

  it('builds every variant and tells them apart', () => {
    const single = ServiceComposition.single();
    const bundle = ServiceComposition.bundle([CUT, BEARD]);
    const unspecified = ServiceComposition.unspecified();
    expect(single).toEqual({ compositionKind: 'SINGLE' });
    expect(bundle).toEqual({
      compositionKind: 'BUNDLE',
      bundleServiceIds: [CUT, BEARD],
    });
    expect(unspecified).toEqual({ compositionKind: 'UNSPECIFIED' });
    expect(ServiceComposition.isBundle(single)).toBe(false);
    expect(ServiceComposition.isBundle(unspecified)).toBe(false);
    expect(ServiceComposition.isBundle(bundle)).toBe(true);
  });

  // catalog.presenter.ts `serviceToVm` — the composition a card draws as.
  it('drawnKind(): a bundle draws as a bundle, anything else as a single service', () => {
    expect(ServiceComposition.drawnKind(CompositionKind.Bundle)).toBe('BUNDLE');
    expect(ServiceComposition.drawnKind(CompositionKind.Single)).toBe('SINGLE');
    // The author never said (`composition: null` as authored): a single
    // service, as it always drew.
    expect(ServiceComposition.drawnKind(CompositionKind.Unspecified)).toBe(
      'SINGLE',
    );
    // Pure: same input, same output.
    expect(ServiceComposition.drawnKind(CompositionKind.Unspecified)).toBe(
      ServiceComposition.drawnKind(CompositionKind.Unspecified),
    );
  });

  it('parts(): the included services in order, none for anything else', () => {
    expect(
      ServiceComposition.parts(ServiceComposition.bundle([CUT, BEARD])),
    ).toEqual([CUT, BEARD]);
    expect(ServiceComposition.parts(ServiceComposition.single())).toEqual([]);
    expect(ServiceComposition.parts(ServiceComposition.unspecified())).toEqual(
      [],
    );
  });
});
