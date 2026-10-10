import { describe, expect, it } from 'vitest';
import { ServiceId } from '../entities/service.entity';
import {
  ServiceComposition,
  ServiceCompositionKind,
} from './service-composition.data';

const CUT = ServiceId.of('svc-classic-cut');
const BEARD = ServiceId.of('svc-beard');

describe('ServiceComposition', () => {
  it('keeps the stored tags', () => {
    expect(ServiceCompositionKind).toEqual({
      Single: 'single',
      Bundle: 'bundle',
    });
  });

  it('builds both variants and tells them apart', () => {
    const single = ServiceComposition.single();
    const bundle = ServiceComposition.bundle([CUT, BEARD]);
    expect(single).toEqual({ kind: 'single' });
    expect(bundle).toEqual({ kind: 'bundle', includes: [CUT, BEARD] });
    expect(ServiceComposition.isBundle(single)).toBe(false);
    expect(ServiceComposition.isBundle(bundle)).toBe(true);
  });

  it('parts(): the included services in order, none for a single service', () => {
    expect(
      ServiceComposition.parts(ServiceComposition.bundle([CUT, BEARD])),
    ).toEqual([CUT, BEARD]);
    expect(ServiceComposition.parts(ServiceComposition.single())).toEqual([]);
  });
});

// catalog service.spec.ts composition cases.
describe('ServiceComposition.parse', () => {
  it('accepts a single service', () => {
    expect(ServiceComposition.parse({ kind: 'single' })).toEqual({
      ok: true,
      value: { kind: 'single' },
    });
  });

  it('accepts a valid bundle', () => {
    expect(
      ServiceComposition.parse({
        kind: 'bundle',
        includes: ['svc-classic-cut', 'svc-beard'],
      }),
    ).toEqual({ ok: true, value: { kind: 'bundle', includes: [CUT, BEARD] } });
  });

  it('rejects a bundle with no includes', () => {
    expect(ServiceComposition.parse({ kind: 'bundle', includes: [] })).toEqual({
      ok: false,
      error: [{ code: 'catalog.service.empty_bundle_includes' }],
    });
  });

  it('rejects every blank included id', () => {
    expect(
      ServiceComposition.parse({
        kind: 'bundle',
        includes: ['', 'svc-beard', ' '],
      }),
    ).toEqual({
      ok: false,
      error: [
        { code: 'catalog.id.empty', idType: 'ServiceId' },
        { code: 'catalog.id.empty', idType: 'ServiceId' },
      ],
    });
  });
});
