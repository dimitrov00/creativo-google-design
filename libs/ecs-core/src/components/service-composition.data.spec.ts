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

// catalog service.spec.ts composition cases.
describe('ServiceComposition.parse', () => {
  it('accepts a single service', () => {
    expect(
      ServiceComposition.parse({ compositionKind: CompositionKind.Single }),
    ).toEqual({ ok: true, value: { compositionKind: 'SINGLE' } });
  });

  it('accepts a valid bundle', () => {
    expect(
      ServiceComposition.parse({
        compositionKind: CompositionKind.Bundle,
        bundleServiceIds: ['svc-classic-cut', 'svc-beard'],
      }),
    ).toEqual({
      ok: true,
      value: { compositionKind: 'BUNDLE', bundleServiceIds: [CUT, BEARD] },
    });
  });

  it('rejects a bundle with no includes', () => {
    expect(
      ServiceComposition.parse({
        compositionKind: CompositionKind.Bundle,
        bundleServiceIds: [],
      }),
    ).toEqual({
      ok: false,
      error: [{ errorCode: 'CATALOG_SERVICE_EMPTY_BUNDLE_INCLUDES' }],
    });
  });

  it('rejects every blank included id', () => {
    expect(
      ServiceComposition.parse({
        compositionKind: CompositionKind.Bundle,
        bundleServiceIds: ['', 'svc-beard', ' '],
      }),
    ).toEqual({
      ok: false,
      error: [
        { errorCode: 'CATALOG_ID_EMPTY', idType: 'ServiceId' },
        { errorCode: 'CATALOG_ID_EMPTY', idType: 'ServiceId' },
      ],
    });
  });
});
