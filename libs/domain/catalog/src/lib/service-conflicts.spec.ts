import { describe, expect, it } from 'vitest';
import { Service } from './service';
import {
  conflictingWith,
  selectabilityFor,
  servicesConflict,
} from './service-conflicts';

function service(props: {
  id: string;
  conflictsWith?: readonly string[];
  includes?: readonly string[];
}): Service {
  const result = Service.create({
    id: props.id,
    name: { en: props.id, bg: props.id },
    description: { en: 'x', bg: 'x' },
    categoryId: 'category_hair',
    priceMinorUnits: 1500,
    currencyCode: 'EUR',
    durationMinutes: 30,
    locationIds: [],
    conflictsWith: [...(props.conflictsWith ?? [])],
    composition: props.includes
      ? { kind: 'bundle', includes: [...props.includes] }
      : { kind: 'single' },
    upsellOnly: false,
    popular: false,
    status: 'active',
    sortOrder: 0,
  });
  if (result.isFailure()) throw new Error('bad fixture');
  return result.value;
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

describe('servicesConflict', () => {
  it('honours a conflict authored on both sides', () => {
    expect(servicesConflict(CUT, FADE)).toBe(true);
    expect(servicesConflict(FADE, CUT)).toBe(true);
  });

  it('normalises a ONE-WAY conflict symmetrically', () => {
    // `finish` names nobody; only the cuts name it. Requiring both
    // directions would make this pair silently legal — the catalog bug that
    // only surfaces as a double-booked chair.
    expect(servicesConflict(CUT, FINISH)).toBe(true);
    expect(servicesConflict(FINISH, CUT)).toBe(true);
  });

  it('leaves complementary services alone', () => {
    expect(servicesConflict(CUT, BEARD)).toBe(false);
    expect(servicesConflict(BEARD, FINISH)).toBe(false);
  });

  it('derives a bundle’s conflict with its own components, both directions', () => {
    // Nothing authored this: booking "Full care" plus "Beard trim" would
    // charge twice for one beard, and `includes` is the only place that can
    // be known without going stale when the bundle is edited.
    expect(servicesConflict(FULL_CARE, BEARD)).toBe(true);
    expect(servicesConflict(BEARD, FULL_CARE)).toBe(true);
    expect(servicesConflict(FULL_CARE, CUT)).toBe(true);
  });

  it('does not conflict a bundle with an unrelated service', () => {
    const SHAVE = service({ id: 'shave' });
    expect(servicesConflict(FULL_CARE, SHAVE, CATALOG)).toBe(false);
  });

  it('INHERITS a member’s conflicts through the bundle (needs the catalog)', () => {
    // Full care contains the classic cut, and the cut conflicts with the
    // fade — so booking the bundle AND a fade is two haircuts. Without this
    // you could smuggle a second cut in by hiding one inside a bundle.
    expect(servicesConflict(FULL_CARE, FADE, CATALOG)).toBe(true);
    expect(servicesConflict(FADE, FULL_CARE, CATALOG)).toBe(true);
  });

  it('falls back to the shallow rule when no catalog is supplied', () => {
    // Members cannot be resolved, so only composition and authored
    // conflicts on the two services themselves are decidable.
    expect(servicesConflict(FULL_CARE, FADE)).toBe(false);
    // The bundle-contains rule still holds without a catalog.
    expect(servicesConflict(FULL_CARE, CUT)).toBe(true);
  });

  it('conflicts two different bundles that share a member', () => {
    // Both contain the classic cut; taking both means paying for it twice.
    expect(servicesConflict(FULL_CARE, FATHER_SON, CATALOG)).toBe(true);
  });

  it('never conflicts a service with itself — two lines of one service is a real booking', () => {
    expect(servicesConflict(CUT, CUT)).toBe(false);
    expect(servicesConflict(FULL_CARE, FULL_CARE)).toBe(false);
  });
});

describe('conflictingWith / selectabilityFor', () => {
  it('reports every blocker by id, not merely that one exists', () => {
    const blockers = conflictingWith([CUT, BEARD], FULL_CARE, CATALOG);
    expect(blockers.map((id) => id.value).sort()).toEqual(['beard', 'cut']);
  });

  it('is selectable against an empty selection', () => {
    expect(selectabilityFor([], CUT)).toEqual({ kind: 'selectable' });
  });

  it('is selectable alongside a complementary service', () => {
    expect(selectabilityFor([BEARD], CUT).kind).toBe('selectable');
  });

  it('names the blockers so the UI can explain the lock', () => {
    const selectability = selectabilityFor([CUT], FADE);
    expect(selectability.kind).toBe('blocked');
    if (selectability.kind === 'blocked') {
      expect(selectability.by.map((id) => id.value)).toEqual(['cut']);
    }
  });

  it('scopes to ONE seat — the same pair is legal across two seats', () => {
    // v2's ruling: a Father & Son bundle is legal when two guests each hold
    // one of the conflicting services. The signature enforces it — each
    // call carries a single seat's selection, so nothing here can see the
    // other seat's lines.
    const guestA = [CUT];
    const guestB: Service[] = [];
    expect(selectabilityFor(guestA, FADE).kind).toBe('blocked');
    expect(selectabilityFor(guestB, FADE).kind).toBe('selectable');
  });

  it('lets a seat hold a second line of a service it already holds', () => {
    expect(selectabilityFor([CUT], CUT).kind).toBe('selectable');
  });
});
