/**
 * The landing's demo catalogue as AUTHORED, transcribed from v2's demo seed
 * — test support, never production content: `provideTestCatalog`
 * (`test-catalog.providers.ts`) turns each entry into a `Barber` or
 * `Service` entity behind the catalogue's ports, and the figures a surface
 * prints are `CatalogPricingSystem`'s answers on those. Prices are EUR
 * cents and durations minutes.
 *
 * The shelf is written in its OWN raw input types (below), not the
 * catalogue's view models: its ids stay the literals they were authored as,
 * and the providers brand each once, by construction, as they build the
 * entities (`BarberId.of`, `ServiceId.of`, the catalogue's parse guards).
 */

import { CompositionKind, type LocalizedText } from '@core/components';
import {
  type ServiceSourceVm,
  VariantIcon,
} from '@creativo/features/shared/catalog';

const lt = (en: string, bg: string): LocalizedText => ({ en, bg });

/** A barber as authored — the catalogue's `Barber` fields, its id a literal. */
export interface AuthoredBarber {
  readonly id: string;
  readonly name: LocalizedText;
  readonly title: LocalizedText;
  readonly bio: LocalizedText;
  readonly avatarSrc: string;
  readonly objectPosition: string;
  readonly rating?: number;
  readonly specialty: LocalizedText;
  readonly gallery: readonly string[];
}

/** One terms figure as authored — EUR cents and minutes, raw. */
export interface AuthoredTerms {
  readonly priceCents: number;
  readonly minutes: number;
}

/** Who performs a service as authored, with their per-variant figures. */
export interface AuthoredOffering {
  readonly barberId: string;
  readonly base: AuthoredTerms;
  /** Per-variant terms, by the variant's authored id. */
  readonly byVariant?: Readonly<Record<string, AuthoredTerms>>;
}

/** A variant as authored. */
export interface AuthoredVariant {
  readonly id: string;
  readonly name: LocalizedText;
  readonly icon: VariantIcon;
}

/** A service as authored — the catalogue's authored fields, its ids literals. */
export interface AuthoredService {
  readonly id: string;
  readonly compositionKind: ServiceSourceVm['compositionKind'];
  readonly name: LocalizedText;
  readonly description: LocalizedText;
  readonly coverSrc?: string;
  readonly variants: readonly AuthoredVariant[];
  readonly offerings: readonly AuthoredOffering[];
  /** Bundle members, by authored service id. */
  readonly includes?: readonly string[];
  readonly upsellOnly: boolean;
  readonly gallery: readonly string[];
}

/** The demo barbers as AUTHORED: `provideTestCatalog` turns each into a `Barber` entity. */
export const BARBERS: readonly AuthoredBarber[] = [
  {
    id: 'ivan',
    name: lt('Ivan Kolev', 'Иван Колев'),
    title: lt('Chief barber', 'Главен бръснар'),
    bio: lt(
      'Twelve years on the floor. Classic scissor work and a clean skin fade are his signature.',
      'Дванадесет години на пода. Класическа ножична работа и чист skin фейд са неговата запазена марка.',
    ),
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
    avatarSrc: '/barbers/ivan.jpg',
    objectPosition: '50% 25%',
    rating: 4.9,
  },
  {
    id: 'niko',
    name: lt('Niko Dimov', 'Нико Димов'),
    title: lt('Barber', 'Бръснар'),
    bio: lt(
      "The fade man — gradients so clean you'll rebook on the spot.",
      'Човекът на фейда — градиенти толкова чисти, че ще се върнеш на момента.',
    ),
    specialty: lt(
      'Modern fade · clean geometry',
      'Модерен фейд · чиста геометрия',
    ),
    gallery: [
      '/work/fade-styling.jpg',
      '/work/classic-clippers.jpg',
      '/work/modern-cut.jpg',
      '/work/finishing-touch.jpg',
    ],
    avatarSrc: '/barbers/niko.jpg',
    objectPosition: '50% 25%',
    rating: 4.8,
  },
  {
    id: 'stefan',
    name: lt('Stefan Iliev', 'Стефан Илиев'),
    title: lt('Senior barber', 'Старши бръснар'),
    bio: lt(
      'Old-school straight-razor shaves and beard sculpting, hot towel and all.',
      'Стари правила за бръснене с право острие и скулптуриране на брада, с топла кърпа.',
    ),
    specialty: lt(
      'Razor · ritual · beard contour',
      'Бръснач · ритуал · контур на брада',
    ),
    gallery: [
      '/work/beard-shave.jpg',
      '/work/classic-clippers.jpg',
      '/work/scissors-trim.jpg',
      '/work/fade-styling.jpg',
    ],
    avatarSrc: '/barbers/stefan.jpg',
    objectPosition: '50% 25%',
  },
];

const LENGTH_VARIANTS: readonly AuthoredVariant[] = [
  {
    id: 'short',
    name: lt('Short hair', 'Къса коса'),
    icon: VariantIcon.Length,
  },
  { id: 'long', name: lt('Long hair', 'Дълга коса'), icon: VariantIcon.Length },
];

const t = (priceCents: number, minutes: number): AuthoredTerms => ({
  priceCents,
  minutes,
});

/**
 * The demo shelf as AUTHORED — no figures: the test catalogue
 * (`test-catalog.providers.ts`) turns each into a `Service` entity, and the
 * figures a surface prints are `CatalogPricingSystem`'s answers on it.
 */
export const SERVICES: readonly AuthoredService[] = [
  {
    id: 'haircut',
    compositionKind: CompositionKind.Single,
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
        base: t(1450, 35),
        byVariant: { short: t(1450, 35), long: t(1850, 50) },
      },
      {
        barberId: 'niko',
        base: t(1300, 30),
        byVariant: { short: t(1300, 30), long: t(1650, 45) },
      },
      {
        barberId: 'stefan',
        base: t(1550, 40),
        byVariant: { short: t(1550, 40), long: t(1950, 55) },
      },
    ],
  },
  {
    id: 'fade',
    compositionKind: CompositionKind.Single,
    name: lt('Fade', 'Фейд'),
    description: lt(
      'Precision gradient — skin, low or high — blended to nothing and lined up sharp.',
      'Прецизен градиент — skin, нисък или висок — прелят до нула и очертан остро.',
    ),
    coverSrc: '/work/fade-styling.jpg',
    variants: [
      {
        id: 'skin',
        name: lt('Skin fade', 'Skin фейд'),
        icon: VariantIcon.Skin,
      },
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
        base: t(1550, 40),
        byVariant: { skin: t(1850, 50), short: t(1550, 40), long: t(1800, 50) },
      },
      {
        barberId: 'ivan',
        base: t(1650, 45),
        byVariant: { skin: t(1950, 55), short: t(1650, 45), long: t(1950, 55) },
      },
    ],
  },
  {
    id: 'beard',
    compositionKind: CompositionKind.Single,
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
      { barberId: 'ivan', base: t(750, 15) },
      { barberId: 'niko', base: t(750, 15) },
      { barberId: 'stefan', base: t(900, 20) },
    ],
  },
  {
    id: 'shave',
    compositionKind: CompositionKind.Single,
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
      { barberId: 'stefan', base: t(1150, 30) },
      { barberId: 'ivan', base: t(1000, 25) },
    ],
  },
  {
    id: 'fullcare',
    compositionKind: CompositionKind.Bundle,
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
      { barberId: 'ivan', base: t(2800, 70) },
      { barberId: 'stefan', base: t(3050, 80) },
    ],
  },
  {
    id: 'fatherson',
    compositionKind: CompositionKind.Bundle,
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
      { barberId: 'niko', base: t(2300, 60) },
      { barberId: 'ivan', base: t(2550, 65) },
    ],
  },
  // Upsell-only add-ons exist in the seed but never reach the marketing
  // shelf (v2 filters on `upsellOnly`); carried for the detail sheet's
  // bundle math and the eventual /book port.
  {
    id: 'scalpmassage',
    compositionKind: CompositionKind.Single,
    name: lt('Scalp Massage', 'Масаж на скалпа'),
    description: lt(
      '10-minute scalp massage with essential oils.',
      '10-минутен масаж на скалпа с етерични масла.',
    ),
    variants: [],
    upsellOnly: true,
    gallery: [],
    offerings: [
      { barberId: 'ivan', base: t(400, 10) },
      { barberId: 'niko', base: t(400, 10) },
      { barberId: 'stefan', base: t(400, 10) },
    ],
  },
  {
    id: 'hottowel',
    compositionKind: CompositionKind.Single,
    name: lt('Hot Towel Treatment', 'Гореща кърпа'),
    description: lt(
      'Luxury hot towel wrap — deep pore cleanse.',
      'Луксозно увиване с гореща кърпа — дълбоко почистване.',
    ),
    variants: [],
    upsellOnly: true,
    gallery: [],
    offerings: [
      { barberId: 'ivan', base: t(300, 10) },
      { barberId: 'niko', base: t(300, 10) },
      { barberId: 'stefan', base: t(300, 10) },
    ],
  },
  {
    id: 'premiumoil',
    compositionKind: CompositionKind.Single,
    name: lt('Premium Beard Oil', 'Премиум брадно масло'),
    description: lt(
      'Conditioning beard oil application by your barber.',
      'Нанасяне на подхранващо брадно масло от бербера.',
    ),
    variants: [],
    upsellOnly: true,
    gallery: [],
    offerings: [
      { barberId: 'ivan', base: t(250, 5) },
      { barberId: 'niko', base: t(250, 5) },
      { barberId: 'stefan', base: t(250, 5) },
    ],
  },
  {
    id: 'premiumstyling',
    compositionKind: CompositionKind.Single,
    name: lt('Premium Styling', 'Премиум стайлинг'),
    description: lt(
      'Clay, paste, or pomade finish — expert application.',
      'Глина, паста или помада — професионално нанасяне.',
    ),
    variants: [],
    upsellOnly: true,
    gallery: [],
    offerings: [
      { barberId: 'ivan', base: t(300, 5) },
      { barberId: 'niko', base: t(300, 5) },
      { barberId: 'stefan', base: t(300, 5) },
    ],
  },
];
