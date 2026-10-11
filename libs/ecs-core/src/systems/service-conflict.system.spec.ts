import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { ServiceComposition } from '../components/service-composition.data';
import { ServiceId } from '../primitives/ids.primitive';
import { deepFreeze } from '../testing';
import {
  type ConflictService,
  Selectability,
  ServiceConflictSystem,
} from './service-conflict.system';

/*
 * The cases of libs/domain/catalog/src/lib/service-conflicts.spec.ts (15),
 * COPIED over plain structs — the legacy spec keeps running against the
 * shim. A legacy call without a catalogue passes `[]`.
 */

function service(props: {
  id: string;
  conflictsWith?: readonly string[];
  includes?: readonly string[];
}): ConflictService {
  return {
    id: ServiceId.of(props.id),
    conflictsWith: (props.conflictsWith ?? []).map(ServiceId.of),
    ...(props.includes
      ? ServiceComposition.bundle(props.includes.map(ServiceId.of))
      : ServiceComposition.single()),
  };
}

// Mirrors the seeded catalog: the cuts name each other AND `svc-finish`,
// while `svc-finish` deliberately declares nothing.
const CUT = service({ id: 'cut', conflictsWith: ['fade', 'finish'] });
const FADE = service({ id: 'fade', conflictsWith: ['cut', 'finish'] });
const FINISH = service({ id: 'finish' });
const BEARD = service({ id: 'beard' });
const FULL_CARE = service({ id: 'full-care', includes: ['cut', 'beard'] });
const FATHER_SON = service({ id: 'father-son', includes: ['cut', 'finish'] });

/** The whole menu — what lets bundle members resolve to real services. */
const CATALOG = [CUT, FADE, FINISH, BEARD, FULL_CARE, FATHER_SON];

const { servicesConflict, conflictingWith, selectabilityFor } =
  ServiceConflictSystem;

describe('servicesConflict', () => {
  it('honours a conflict authored on both sides', () => {
    expect(servicesConflict(CUT, FADE, [])).toBe(true);
    expect(servicesConflict(FADE, CUT, [])).toBe(true);
  });

  it('normalises a ONE-WAY conflict symmetrically', () => {
    // `finish` names nobody; only the cuts name it. Requiring both
    // directions would make this pair silently legal — the catalog bug that
    // only surfaces as a double-booked chair.
    expect(servicesConflict(CUT, FINISH, [])).toBe(true);
    expect(servicesConflict(FINISH, CUT, [])).toBe(true);
  });

  it('leaves complementary services alone', () => {
    expect(servicesConflict(CUT, BEARD, [])).toBe(false);
    expect(servicesConflict(BEARD, FINISH, [])).toBe(false);
  });

  it('derives a bundle’s conflict with its own components, both directions', () => {
    expect(servicesConflict(FULL_CARE, BEARD, [])).toBe(true);
    expect(servicesConflict(BEARD, FULL_CARE, [])).toBe(true);
    expect(servicesConflict(FULL_CARE, CUT, [])).toBe(true);
  });

  it('does not conflict a bundle with an unrelated service', () => {
    const SHAVE = service({ id: 'shave' });
    expect(servicesConflict(FULL_CARE, SHAVE, CATALOG)).toBe(false);
  });

  it('INHERITS a member’s conflicts through the bundle (needs the catalog)', () => {
    // Full care contains the classic cut, and the cut conflicts with the
    // fade — so booking the bundle AND a fade is two haircuts.
    expect(servicesConflict(FULL_CARE, FADE, CATALOG)).toBe(true);
    expect(servicesConflict(FADE, FULL_CARE, CATALOG)).toBe(true);
  });

  it('falls back to the shallow rule when no catalog is supplied', () => {
    // Members cannot be resolved, so only composition and authored
    // conflicts on the two services themselves are decidable.
    expect(servicesConflict(FULL_CARE, FADE, [])).toBe(false);
    // The bundle-contains rule still holds without a catalog.
    expect(servicesConflict(FULL_CARE, CUT, [])).toBe(true);
  });

  it('conflicts two different bundles that share a member', () => {
    // Both contain the classic cut; taking both means paying for it twice.
    expect(servicesConflict(FULL_CARE, FATHER_SON, CATALOG)).toBe(true);
  });

  it('never conflicts a service with itself — two lines of one service is a real booking', () => {
    expect(servicesConflict(CUT, CUT, [])).toBe(false);
    expect(servicesConflict(FULL_CARE, FULL_CARE, [])).toBe(false);
  });
});

describe('conflictingWith / selectabilityFor', () => {
  it('reports every blocker by id, not merely that one exists', () => {
    const blockers = conflictingWith([CUT, BEARD], FULL_CARE, CATALOG);
    expect([...blockers].sort()).toEqual(['beard', 'cut']);
  });

  it('is selectable against an empty selection', () => {
    expect(selectabilityFor([], CUT, [])).toEqual({
      selectability: 'SELECTABLE',
    });
  });

  it('is selectable alongside a complementary service', () => {
    expect(selectabilityFor([BEARD], CUT, []).selectability).toBe('SELECTABLE');
  });

  it('names the blockers so the UI can explain the lock', () => {
    const selectability = selectabilityFor([CUT], FADE, []);
    expect(selectability.selectability).toBe('BLOCKED');
    if (selectability.selectability === Selectability.Blocked) {
      expect(selectability.by).toEqual(['cut']);
    }
  });

  it('scopes to ONE seat — the same pair is legal across two seats', () => {
    const guestA = [CUT];
    const guestB: ConflictService[] = [];
    expect(selectabilityFor(guestA, FADE, []).selectability).toBe('BLOCKED');
    expect(selectabilityFor(guestB, FADE, []).selectability).toBe('SELECTABLE');
  });

  it('lets a seat hold a second line of a service it already holds', () => {
    expect(selectabilityFor([CUT], CUT, []).selectability).toBe('SELECTABLE');
  });
});

describe('ServiceConflictSystem — algebra and purity', () => {
  const anyService = fc.constantFrom(...CATALOG);

  it('is symmetric whatever the catalogue (property)', () => {
    fc.assert(
      fc.property(anyService, anyService, fc.boolean(), (a, b, withCatalog) => {
        const catalog = withCatalog ? CATALOG : [];
        expect(servicesConflict(a, b, catalog)).toBe(
          servicesConflict(b, a, catalog),
        );
      }),
    );
  });

  it('treats an UNSPECIFIED composition (the stored `null`) as a single service', () => {
    const bare: ConflictService = {
      id: ServiceId.of('bare'),
      conflictsWith: [ServiceId.of('cut')],
      ...ServiceComposition.unspecified(),
    };
    expect(servicesConflict(bare, CUT, CATALOG)).toBe(true);
    expect(servicesConflict(bare, BEARD, CATALOG)).toBe(false);
  });

  it('is pure: same input → same output, inputs untouched', () => {
    const catalog = deepFreeze(CATALOG.map((entry) => ({ ...entry })));
    const selection = deepFreeze([CUT, BEARD]);
    const run = () => ({
      blockers: conflictingWith(selection, FULL_CARE, catalog),
      selectability: selectabilityFor(selection, FADE, catalog),
      conflict: servicesConflict(FATHER_SON, FULL_CARE, catalog),
    });
    const once = run();
    expect(run()).toEqual(once);
    expect(catalog.map((entry) => entry.id)).toEqual(
      CATALOG.map((entry) => entry.id),
    );
    expect(selection.map((entry) => entry.id)).toEqual(['cut', 'beard']);
  });
});
