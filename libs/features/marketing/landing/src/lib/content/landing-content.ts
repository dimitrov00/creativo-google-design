/**
 * Landing view-models + the bundled demo content, transcribed 1:1 from v2's
 * demo catalog seed (`../v2/apps/web/src/lib/catalog/demo/{seed,seed-media}.ts`).
 *
 * v2's landing renders THIS data (its catalog port serves the same in-memory
 * seed), so visual parity requires content parity. The shapes here are
 * presentational: localized strings stay `{ en, bg }` pairs resolved at render
 * time, money is EUR major units, durations are minutes. Live catalog data
 * (when Firestore has content) overlays this fixture in
 * `LandingContentService` — same "demo seed today, Firestore tomorrow" posture
 * v2 ships with.
 */

export interface Localized {
  readonly en: string;
  readonly bg: string;
}

const lt = (en: string, bg: string): Localized => ({ en, bg });

// ─── Work gallery ───────────────────────────────────────────────────────

/** Editorial art direction — per-shot aspect boxes, parallax drift, caption
 *  key. Order IS the strip order (v2 `work-gallery.tsx` ART_DIRECTION). */
export interface WorkShotVm {
  readonly id: string;
  readonly src: string;
  readonly alt: Localized;
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

// ─── Barbers ────────────────────────────────────────────────────────────

export interface BarberVm {
  readonly id: string;
  readonly name: Localized;
  readonly title: Localized;
  readonly bio: Localized;
  readonly avatarSrc: string;
  /** v2 seeds every avatar with FocalPoint(0.5, 0.25) → object-position. */
  readonly objectPosition: string;
}

export const BARBERS: readonly BarberVm[] = [
  {
    id: 'ivan',
    name: lt('Ivan Kolev', 'Иван Колев'),
    title: lt('Chief barber', 'Главен бръснар'),
    bio: lt(
      'Twelve years on the floor. Classic scissor work and a clean skin fade are his signature.',
      'Дванадесет години на пода. Класическа ножична работа и чист skin фейд са неговата запазена марка.',
    ),
    avatarSrc: '/barbers/ivan.jpg',
    objectPosition: '50% 25%',
  },
  {
    id: 'niko',
    name: lt('Niko Dimov', 'Нико Димов'),
    title: lt('Barber', 'Бръснар'),
    bio: lt(
      "The fade man — gradients so clean you'll rebook on the spot.",
      'Човекът на фейда — градиенти толкова чисти, че ще се върнеш на момента.',
    ),
    avatarSrc: '/barbers/niko.jpg',
    objectPosition: '50% 25%',
  },
  {
    id: 'stefan',
    name: lt('Stefan Iliev', 'Стефан Илиев'),
    title: lt('Senior barber', 'Старши бръснар'),
    bio: lt(
      'Old-school straight-razor shaves and beard sculpting, hot towel and all.',
      'Стари правила за бръснене с право острие и скулптуриране на брада, с топла кърпа.',
    ),
    avatarSrc: '/barbers/stefan.jpg',
    objectPosition: '50% 25%',
  },
];

// ─── Services ───────────────────────────────────────────────────────────

export interface ServiceTermsVm {
  /** EUR, major units (may carry .5). */
  readonly price: number;
  readonly minutes: number;
}

export interface ServiceOfferingVm {
  readonly barberId: string;
  readonly base: ServiceTermsVm;
  readonly byVariant?: Readonly<Record<string, ServiceTermsVm>>;
}

export interface ServiceVariantVm {
  readonly id: string;
  readonly name: Localized;
  readonly icon: 'length' | 'skin';
}

export interface ServiceVm {
  readonly id: string;
  readonly kind: 'single' | 'bundle';
  readonly name: Localized;
  readonly description: Localized;
  readonly coverSrc?: string;
  readonly variants: readonly ServiceVariantVm[];
  readonly offerings: readonly ServiceOfferingVm[];
  /** Bundle members, by service id. */
  readonly includes?: readonly string[];
  readonly upsellOnly: boolean;
  /** Gallery frames for the detail sheet (v2 serviceLinks order). */
  readonly gallery: readonly string[];
}

const LENGTH_VARIANTS: readonly ServiceVariantVm[] = [
  { id: 'short', name: lt('Short hair', 'Къса коса'), icon: 'length' },
  { id: 'long', name: lt('Long hair', 'Дълга коса'), icon: 'length' },
];

const t = (price: number, minutes: number): ServiceTermsVm => ({
  price,
  minutes,
});

export const SERVICES: readonly ServiceVm[] = [
  {
    id: 'haircut',
    kind: 'single',
    name: lt('Classic haircut', 'Класическо подстригване'),
    description: lt(
      'Scissor or clipper cut shaped to your head, finished with a wash and styling.',
      'Подстригване с ножица или машинка по формата на главата, завършено с измиване и стайлинг.',
    ),
    coverSrc: '/work/modern-cut.jpg',
    variants: LENGTH_VARIANTS,
    upsellOnly: false,
    gallery: [
      '/work/modern-cut.jpg',
      '/work/scissors-trim.jpg',
      '/work/fade-styling.jpg',
      '/work/finishing-touch.jpg',
    ],
    offerings: [
      {
        barberId: 'ivan',
        base: t(14.5, 35),
        byVariant: { short: t(14.5, 35), long: t(18.5, 50) },
      },
      {
        barberId: 'niko',
        base: t(13, 30),
        byVariant: { short: t(13, 30), long: t(16.5, 45) },
      },
      {
        barberId: 'stefan',
        base: t(15.5, 40),
        byVariant: { short: t(15.5, 40), long: t(19.5, 55) },
      },
    ],
  },
  {
    id: 'fade',
    kind: 'single',
    name: lt('Fade', 'Фейд'),
    description: lt(
      'Precision gradient — skin, low or high — blended to nothing and lined up sharp.',
      'Прецизен градиент — skin, нисък или висок — прелят до нула и очертан остро.',
    ),
    coverSrc: '/work/fade-styling.jpg',
    variants: [
      { id: 'skin', name: lt('Skin fade', 'Skin фейд'), icon: 'skin' },
      ...LENGTH_VARIANTS,
    ],
    upsellOnly: false,
    gallery: [
      '/work/fade-styling.jpg',
      '/work/classic-clippers.jpg',
      '/work/modern-cut.jpg',
    ],
    offerings: [
      {
        barberId: 'niko',
        base: t(15.5, 40),
        byVariant: { skin: t(18.5, 50), short: t(15.5, 40), long: t(18, 50) },
      },
      {
        barberId: 'ivan',
        base: t(16.5, 45),
        byVariant: { skin: t(19.5, 55), short: t(16.5, 45), long: t(19.5, 55) },
      },
    ],
  },
  {
    id: 'beard',
    kind: 'single',
    // No cover — exercises the scissors-glyph fallback tile, exactly like v2.
    name: lt('Beard grooming', 'Оформяне на брада'),
    description: lt(
      'Shape, trim and line the beard — clean edges, even length.',
      'Оформяне, подравняване и очертаване на брадата — чисти линии, равна дължина.',
    ),
    variants: [],
    upsellOnly: false,
    gallery: [],
    offerings: [
      { barberId: 'ivan', base: t(7.5, 15) },
      { barberId: 'niko', base: t(7.5, 15) },
      { barberId: 'stefan', base: t(9, 20) },
    ],
  },
  {
    id: 'shave',
    kind: 'single',
    name: lt('Hot towel shave', 'Бръснене с топла кърпа'),
    description: lt(
      'Old-school straight-razor shave with hot towels and essential oils.',
      'Класическо бръснене с право острие, топли кърпи и есенциални масла.',
    ),
    coverSrc: '/work/beard-shave.jpg',
    variants: [],
    upsellOnly: false,
    gallery: [
      '/work/beard-shave.jpg',
      '/work/classic-clippers.jpg',
      '/work/finishing-touch.jpg',
    ],
    offerings: [
      { barberId: 'stefan', base: t(11.5, 30) },
      { barberId: 'ivan', base: t(10, 25) },
    ],
  },
  {
    id: 'fullcare',
    kind: 'bundle',
    name: lt('Full care', 'Пълна грижа'),
    description: lt(
      'Haircut, beard grooming and a hot towel shave in one sitting.',
      'Подстригване, оформяне на брада и бръснене с топла кърпа в едно посещение.',
    ),
    coverSrc: '/work/classic-clippers.jpg',
    variants: [],
    includes: ['haircut', 'beard', 'shave'],
    upsellOnly: false,
    gallery: [
      '/work/finishing-touch.jpg',
      '/work/beard-shave.jpg',
      '/work/modern-cut.jpg',
    ],
    offerings: [
      { barberId: 'ivan', base: t(28, 70) },
      { barberId: 'stefan', base: t(30.5, 80) },
    ],
  },
  {
    id: 'fatherson',
    kind: 'bundle',
    name: lt('Father & son', 'Баща и син'),
    description: lt(
      'Two classic haircuts back to back — bring the little one along.',
      'Две класически подстригвания едно след друго — доведи и малкия.',
    ),
    coverSrc: '/work/finishing-touch.jpg',
    variants: [],
    includes: ['haircut', 'haircut'],
    upsellOnly: false,
    gallery: [],
    offerings: [
      { barberId: 'niko', base: t(23, 60) },
      { barberId: 'ivan', base: t(25.5, 65) },
    ],
  },
  // Upsell-only add-ons exist in the seed but never reach the marketing
  // shelf (v2 filters on `upsellOnly`); carried for the detail sheet's
  // bundle math and the eventual /book port.
  {
    id: 'scalpmassage',
    kind: 'single',
    name: lt('Scalp Massage', 'Масаж на скалпа'),
    description: lt(
      '10-minute scalp massage with essential oils.',
      '10-минутен масаж на скалпа с етерични масла.',
    ),
    variants: [],
    upsellOnly: true,
    gallery: [],
    offerings: [
      { barberId: 'ivan', base: t(4, 10) },
      { barberId: 'niko', base: t(4, 10) },
      { barberId: 'stefan', base: t(4, 10) },
    ],
  },
  {
    id: 'hottowel',
    kind: 'single',
    name: lt('Hot Towel Treatment', 'Гореща кърпа'),
    description: lt(
      'Luxury hot towel wrap — deep pore cleanse.',
      'Луксозно увиване с гореща кърпа — дълбоко почистване.',
    ),
    variants: [],
    upsellOnly: true,
    gallery: [],
    offerings: [
      { barberId: 'ivan', base: t(3, 10) },
      { barberId: 'niko', base: t(3, 10) },
      { barberId: 'stefan', base: t(3, 10) },
    ],
  },
  {
    id: 'premiumoil',
    kind: 'single',
    name: lt('Premium Beard Oil', 'Премиум брадно масло'),
    description: lt(
      'Conditioning beard oil application by your barber.',
      'Нанасяне на подхранващо брадно масло от бербера.',
    ),
    variants: [],
    upsellOnly: true,
    gallery: [],
    offerings: [
      { barberId: 'ivan', base: t(2.5, 5) },
      { barberId: 'niko', base: t(2.5, 5) },
      { barberId: 'stefan', base: t(2.5, 5) },
    ],
  },
  {
    id: 'premiumstyling',
    kind: 'single',
    name: lt('Premium Styling', 'Премиум стайлинг'),
    description: lt(
      'Clay, paste, or pomade finish — expert application.',
      'Глина, паста или помада — професионално нанасяне.',
    ),
    variants: [],
    upsellOnly: true,
    gallery: [],
    offerings: [
      { barberId: 'ivan', base: t(3, 5) },
      { barberId: 'niko', base: t(3, 5) },
      { barberId: 'stefan', base: t(3, 5) },
    ],
  },
];

// ─── Locations ──────────────────────────────────────────────────────────

export type DayHoursVm =
  | { readonly kind: 'open'; readonly opens: string; readonly closes: string }
  | { readonly kind: 'closed' };

export interface LocationVm {
  readonly id: string;
  readonly name: Localized;
  readonly address: Localized;
  readonly phoneE164: string;
  readonly phoneDisplay: string;
  readonly mapUrl: string;
  readonly geo: { readonly lat: number; readonly lng: number };
  /** ISO order — index 0 is Monday. */
  readonly hours: readonly DayHoursVm[];
  readonly timezone: string;
}

const open = (opens: string, closes: string): DayHoursVm => ({
  kind: 'open',
  opens,
  closes,
});
const closed: DayHoursVm = { kind: 'closed' };

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
    hours: [
      open('09:00', '20:00'),
      open('09:00', '20:00'),
      open('09:00', '20:00'),
      open('09:00', '20:00'),
      open('09:00', '21:00'),
      open('10:00', '18:00'),
      closed,
    ],
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
    hours: [
      closed,
      open('10:00', '19:00'),
      open('10:00', '19:00'),
      open('10:00', '19:00'),
      open('10:00', '19:00'),
      open('09:00', '16:00'),
      closed,
    ],
    timezone: 'Europe/Sofia',
  },
];

// ─── Formatting (v2 lib/format-money + format-duration semantics) ────────

/** Whole amounts drop the zeros (5 €), fractional keep two (14,50 €). */
export function formatPrice(major: number, locale: string): string {
  const fractionDigits = Number.isInteger(major) ? 0 : 2;
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(major);
}

export function formatDurationRange(
  min: number,
  max: number,
  locale: string,
): string {
  const formatter = new Intl.NumberFormat(locale, {
    style: 'unit',
    unit: 'minute',
    unitDisplay: 'narrow',
  });
  if (min === max) return formatter.format(min);
  // `formatRange` postdates the workspace TS lib — feature-detect at runtime.
  const ranged = formatter as Intl.NumberFormat & {
    formatRange?: (start: number, end: number) => string;
  };
  if (typeof ranged.formatRange === 'function') {
    return ranged.formatRange(min, max);
  }
  return `${new Intl.NumberFormat(locale, { useGrouping: false }).format(min)}–${formatter.format(max)}`;
}

/** Cheapest base offering — the "from" price on a marketing tile. */
export function servicePriceFrom(service: ServiceVm): number {
  return Math.min(...service.offerings.map((offering) => offering.base.price));
}

/** Global duration range across offerings × variants (v2 Service.durationRange). */
export function serviceDurationRange(service: ServiceVm): {
  from: number;
  to: number;
} {
  const minutes = service.offerings.flatMap((offering) => [
    offering.base.minutes,
    ...Object.values(offering.byVariant ?? {}).map((terms) => terms.minutes),
  ]);
  return { from: Math.min(...minutes), to: Math.max(...minutes) };
}
