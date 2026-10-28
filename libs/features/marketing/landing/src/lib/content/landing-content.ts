/**
 * The landing's hand-authored content: the work gallery's art direction
 * and the two shops, as presentational view models — localized strings
 * stay `LocalizedText` pairs resolved at render time. Services and barbers
 * are the catalogue's (`CatalogContentService`, behind
 * `LandingContentService`); the authored shelf the specs serve through the
 * catalogue's ports is test support (`src/testing/landing-catalog.ts`).
 */

import type { LocalizedText } from '@core/components';

const lt = (en: string, bg: string): LocalizedText => ({ en, bg });

// ─── Work gallery ───────────────────────────────────────────────────────

/** Editorial art direction — per-shot aspect boxes, parallax drift, caption
 *  key. Order IS the strip order (v2 `work-gallery.tsx` ART_DIRECTION). */
export interface WorkShotVm {
  readonly id: string;
  readonly src: string;
  readonly alt: LocalizedText;
  readonly aspectRatio: string;
  readonly driftY: number;
  readonly captionKey: string;
}

export const WORK_SHOTS: readonly WorkShotVm[] = [
  {
    id: 'work-scissors-trim',
    src: '/work/scissors-trim.jpg',
    alt: lt(
      'Scissor-over-comb trim in progress on the salon chair',
      'Подстригване с ножица върху гребен в салонния стол',
    ),
    aspectRatio: '4/5',
    driftY: 28,
    captionKey: 'landing.gallery.c0',
  },
  {
    id: 'work-modern-cut',
    src: '/work/modern-cut.jpg',
    alt: lt(
      'Modern textured crop with a clean taper, styled matte',
      'Модерна текстурирана подстрижка с чист преход, матов стайлинг',
    ),
    aspectRatio: '1/1',
    driftY: -36,
    captionKey: 'landing.gallery.c1',
  },
  {
    id: 'work-classic-clippers',
    src: '/work/classic-clippers.jpg',
    alt: lt(
      'Classic clipper work shaping a low fade at the station',
      'Класическа работа с машинка — оформяне на нисък фейд на стола',
    ),
    aspectRatio: '4/5',
    driftY: 16,
    captionKey: 'landing.gallery.c2',
  },
  {
    id: 'work-fade-styling',
    src: '/work/fade-styling.jpg',
    alt: lt(
      'High skin fade blended to nothing, finished with styling paste',
      'Висок skin фейд, прелят до нула и завършен със стайлинг паста',
    ),
    aspectRatio: '3/4',
    driftY: -28,
    captionKey: 'landing.gallery.c3',
  },
  {
    id: 'work-beard-shave',
    src: '/work/beard-shave.jpg',
    alt: lt(
      'Hot towel straight-razor shave with lather brush',
      'Бръснене с право острие и топла кърпа, пяна с четка',
    ),
    aspectRatio: '4/5',
    driftY: 36,
    captionKey: 'landing.gallery.c4',
  },
  {
    id: 'work-finishing-touch',
    src: '/work/finishing-touch.jpg',
    alt: lt(
      'Straight-razor edge-up finishing a fresh haircut',
      'Финален контур с право острие след прясно подстригване',
    ),
    aspectRatio: '3/4',
    driftY: -16,
    captionKey: 'landing.gallery.c5',
  },
];

// ─── Locations ──────────────────────────────────────────────────────────

export interface LocationVm {
  readonly id: string;
  readonly name: LocalizedText;
  readonly address: LocalizedText;
  readonly phoneE164: string;
  readonly phoneDisplay: string;
  readonly mapUrl: string;
  readonly geo: { readonly lat: number; readonly lng: number };
  readonly timezone: string;
}

export const LOCATIONS: readonly LocationVm[] = [
  {
    id: 'center',
    name: lt('Creativo · Center', 'Креативо · Център'),
    address: lt(
      '120 Tsar Simeon Veliki Blvd, Stara Zagora',
      'бул. „Цар Симеон Велики“ 120, Стара Загора',
    ),
    phoneE164: '+359881234567',
    phoneDisplay: '+359 88 123 4567',
    mapUrl: 'https://maps.google.com/?q=Stara+Zagora+Tsar+Simeon+Veliki+120',
    geo: { lat: 42.4271, lng: 25.6366 },
    timezone: 'Europe/Sofia',
  },
  {
    id: 'mladost',
    name: lt('Creativo · Mladost', 'Креативо · Младост'),
    address: lt(
      '14 Armeyska St, Mladost, Stara Zagora',
      'ул. „Армейска“ 14, Младост, Стара Загора',
    ),
    phoneE164: '+359887654321',
    phoneDisplay: '+359 88 765 4321',
    mapUrl: 'https://maps.google.com/?q=Stara+Zagora+Mladost+Armeyska+14',
    geo: { lat: 42.46, lng: 25.685 },
    timezone: 'Europe/Sofia',
  },
];
