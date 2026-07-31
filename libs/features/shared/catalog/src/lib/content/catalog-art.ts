import type { Localized } from './catalog-vm';

/** Terse localized-pair literal — these tables are mostly copy. */
const lt = (en: string, bg: string): Localized => ({ en, bg });

/**
 * Art direction — the editorial extras the catalog has no business carrying.
 *
 * A barber's selected-work gallery, their one-line craft summary, an avatar's
 * focal point: none of it has business meaning, none of it belongs in
 * Firestore, and all of it is keyed by id and merged onto whatever the catalog
 * returns.
 *
 * It lives HERE, in the shared catalog lib, because every surface that renders
 * a service or a barber needs it — the landing, onboarding, AND `/book`. It
 * used to live in `features/marketing/landing`, which booking cannot import,
 * so booking rendered the shared detail sheet with an empty gallery and the
 * media section silently vanished. The sheet was reused; the data it needed
 * was not, and the drift showed up as a missing section rather than an error.
 */

export const BARBER_ART: Readonly<
  Record<
    string,
    {
      readonly specialty: Localized;
      readonly gallery: readonly string[];
      readonly objectPosition: string;
    }
  >
> = {
  ivan: {
    specialty: lt(
      'Scissors · shape · natural movement',
      'Ножица · форма · естествено движение',
    ),
    gallery: [
      '/work/scissors-trim.jpg',
      '/work/modern-cut.jpg',
      '/work/finishing-touch.jpg',
      '/work/classic-clippers.jpg',
    ],
    objectPosition: '50% 25%',
  },
  niko: {
    specialty: lt(
      'Fades · gradients · clean lines',
      'Фейд · градиент · чисти линии',
    ),
    gallery: [
      '/work/fade-styling.jpg',
      '/work/modern-cut.jpg',
      '/work/classic-clippers.jpg',
    ],
    objectPosition: '50% 25%',
  },
  stefan: {
    specialty: lt(
      'Straight razor · beard · hot towel',
      'Права бръсначка · брада · гореща кърпа',
    ),
    gallery: [
      '/work/beard-shave.jpg',
      '/work/finishing-touch.jpg',
      '/work/scissors-trim.jpg',
    ],
    objectPosition: '50% 25%',
  },
};

export const SERVICE_ART: Readonly<
  Record<string, { readonly gallery: readonly string[] }>
> = {
  'svc-classic-cut': {
    gallery: [
      '/work/classic-clippers.jpg',
      '/work/modern-cut.jpg',
      '/work/finishing-touch.jpg',
    ],
  },
  'svc-fade': {
    gallery: ['/work/fade-styling.jpg', '/work/modern-cut.jpg'],
  },
  'svc-beard': {
    gallery: ['/work/beard-shave.jpg', '/work/finishing-touch.jpg'],
  },
  'svc-scissor-trim': {
    gallery: ['/work/scissors-trim.jpg', '/work/modern-cut.jpg'],
  },
  'svc-modern-cut': {
    gallery: ['/work/modern-cut.jpg', '/work/fade-styling.jpg'],
  },
  'svc-finish': {
    gallery: ['/work/finishing-touch.jpg'],
  },
};
