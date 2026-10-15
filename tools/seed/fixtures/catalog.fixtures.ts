/**
 * THE DEV CATALOGUE'S DOCUMENTS (ECS migration, flip 1 — booking core):
 * `serviceCategories`, `locations`, `barbers` and `services`, each body the
 * flat archetype minus its `id` (Laws 5 and 6), every value a branded
 * primitive built by its companion (Law 7.4), every body `satisfies` its
 * entity so a stale shape fails `pnpm nx typecheck seed-tools`.
 *
 * The plan logic that READS the catalogue — a barber's bookable window, the
 * terms a chair sells a seat at (`tools/seed/catalog.mjs`) — reads these
 * same bodies, so the seed's history is priced at exactly what the
 * documents say. Nothing here touches Firebase: the seed uploads the cover
 * and avatar pictures named by `file` to each body's `*MediaPath`, and
 * writes the bodies.
 *
 * This file is also the home of the seed's brand helpers (`cents`, `at`,
 * `day`, …), which every other `*.fixtures.ts` imports: a fixture literal
 * becomes a brand through its companion's smart constructor, and a value a
 * companion refuses is a broken fixture — a programmer defect, thrown.
 */
import {
  BarberStatus,
  DayHours,
  GeoPoint,
  LocationStatus,
  type LocalizedText,
  ServiceComposition,
  ServiceStatus,
  ServiceTerms,
  type BarberOffering,
  type ServiceVariant,
  type VariantTerms,
  VenuePhone,
} from '@core/components';
import type {
  Barber,
  Service,
  ServiceCategory,
  ShopLocation,
} from '@core/entities';
import {
  BarberId,
  Currency,
  defect,
  DurationMinutes,
  EndMinute,
  LocalDate,
  LocationId,
  MediaRefId,
  MinuteCount,
  MinuteOfDay,
  PriceCents,
  type Result,
  ServiceCategoryId,
  ServiceId,
  ServiceVariantId,
  type TimeZone,
} from '@core/primitives';
import { PhoneSystem, ZonedTimeSystem } from '@core/systems';

/**
 * A document's body: the archetype minus its `id` — per VARIANT. TypeScript's
 * `Omit` is not distributive (it keeps only the keys every variant shares),
 * so an archetype with a variant slice (a lifecycle, a coupon's value) is
 * held to `Omit<X, 'id'>` of each of its variants by this one alias; for an
 * archetype without one it IS `Omit<X, 'id'>`.
 */
export type Body<X> = Without<X, 'id'>;

/** `Omit` per variant of `X` — the distributive form `Body` is built from. */
export type Without<X, K extends PropertyKey> = X extends unknown
  ? Omit<X, K>
  : never;

/** A document to write: where (`id`, under its collection) and what (`body`). */
export type Seeded<Id, X> = {
  readonly id: Id;
  readonly body: Body<X>;
};

// ── Brand helpers (a refused fixture literal is a defect) ──────────────────

/** The value of a smart constructor's answer, or a defect naming the fixture. */
export function sure<T, E>(result: Result<T, E>, what: string): T {
  return result.ok ? result.value : defect(`seed fixture: ${what}`);
}

/** A guard's answer that is not `null`, or a defect naming the fixture. */
export function present<T>(value: T | null, what: string): T {
  return value === null ? defect(`seed fixture: ${what}`) : value;
}

export const cents = (raw: number): PriceCents =>
  sure(PriceCents.of(raw), `price ${raw}`);
export const minutesLong = (raw: number): DurationMinutes =>
  sure(DurationMinutes.of(raw), `duration ${raw}`);
export const minuteCount = (raw: number): MinuteCount =>
  sure(MinuteCount.of(raw), `minute count ${raw}`);
/** A start on the shop's wall clock, `at(9, 30)` = 09:30. */
export const at = (hour: number, minute = 0): MinuteOfDay =>
  sure(MinuteOfDay.of(hour * 60 + minute), `start ${hour}:${minute}`);
/** An end on the shop's wall clock (may be 24:00). */
export const until = (hour: number, minute = 0): EndMinute =>
  sure(EndMinute.of(hour * 60 + minute), `end ${hour}:${minute}`);
/** A start, as minutes past midnight. */
export const startAt = (minutes: number): MinuteOfDay =>
  sure(MinuteOfDay.of(minutes), `start ${minutes}`);
/** An end, as minutes past midnight. */
export const endAt = (minutes: number): EndMinute =>
  sure(EndMinute.of(minutes), `end ${minutes}`);
/** A shop day, `YYYY-MM-DD`. */
export const day = (raw: string): LocalDate =>
  sure(LocalDate.parse(raw), `day ${raw}`);
/** The shop's zone — configuration of the location only (Law 7.2). */
export const zone = (raw: string): TimeZone =>
  sure(ZonedTimeSystem.checkZone(raw), `zone ${raw}`);

/** Both shops keep Sofia's clock. */
export const SHOP_TIME_ZONE: TimeZone = zone('Europe/Sofia');

/** 28,00 € for 30 minutes, no pads — the seed's terms from euros and minutes. */
export function terms(euros: number, minutes: number): ServiceTerms {
  return ServiceTerms.of(
    cents(Math.round(euros * 100)),
    Currency.EUR,
    minutesLong(minutes),
    minuteCount(0),
    minuteCount(0),
  );
}

// ── The category ───────────────────────────────────────────────────────────

export const CATEGORY = {
  id: ServiceCategoryId.of('cat-hair'),
  body: {
    name: { bg: 'Коса и брада', en: 'Hair & beard' },
    sortOrder: 1,
  } satisfies Omit<ServiceCategory, 'id'>,
} as const;

// ── The two shops ──────────────────────────────────────────────────────────

export const CENTER = LocationId.of('loc-center');
export const MLADOST = LocationId.of('loc-mladost');

/** Open from `opens` to `closes` (whole hours). */
const open = (opens: number, closes: number): DayHours =>
  DayHours.open(at(opens), until(closes));
const CLOSED: DayHours = DayHours.closed();

/** A shop's phone, parsed at the edge as the catalogue handler parses one. */
function phone(e164: string, display: string): VenuePhone {
  const parsed = sure(PhoneSystem.parse(e164, null), `phone ${e164}`);
  return sure(VenuePhone.of(parsed.e164, display), `phone display ${display}`);
}

/** No cover picture: all seven fields `null` together. */
const NO_COVER = {
  coverMediaId: null,
  coverMediaPath: null,
  coverMediaWidth: null,
  coverMediaHeight: null,
  coverMediaBlurhash: null,
  coverMediaFocalX: null,
  coverMediaFocalY: null,
} as const;

/**
 * The two shops, matching the hours the landing's locations section has
 * been rendering from hand-authored content: `openingHours` is the outer
 * envelope every barber's working hours are clamped to (seven days, Monday
 * first), and `timeZone` is the clock every wall-clock coordinate of the
 * shop is read in.
 */
export const LOCATIONS: readonly Seeded<LocationId, ShopLocation>[] = [
  {
    id: CENTER,
    body: {
      name: { bg: 'Креативо · Център', en: 'Creativo · Center' },
      // The shop without the brand both shops carry, as a visit row's fact
      // line names it.
      shortName: { bg: 'Център', en: 'Center' },
      address: {
        bg: 'бул. „Цар Симеон Велики“ 120, Стара Загора',
        en: '120 Tsar Simeon Veliki Blvd, Stara Zagora',
      },
      mapUrl: null,
      photos: [],
      openingHours: [
        open(9, 20),
        open(9, 20),
        open(9, 20),
        open(9, 20),
        open(9, 21),
        open(10, 18),
        CLOSED,
      ],
      timeZone: SHOP_TIME_ZONE,
      locationStatus: LocationStatus.Active,
      sortOrder: 1,
      ...sure(GeoPoint.parse(42.4271, 25.6366), 'geo loc-center'),
      ...phone('+359881234567', '+359 88 123 4567'),
      ...NO_COVER,
    } satisfies Omit<ShopLocation, 'id'>,
  },
  {
    id: MLADOST,
    body: {
      name: { bg: 'Креативо · Младост', en: 'Creativo · Mladost' },
      shortName: { bg: 'Младост', en: 'Mladost' },
      address: {
        bg: 'ул. „Армейска“ 14, Младост, Стара Загора',
        en: '14 Armeyska St, Mladost, Stara Zagora',
      },
      mapUrl: null,
      photos: [],
      openingHours: [
        CLOSED,
        open(10, 19),
        open(10, 19),
        open(10, 19),
        open(10, 19),
        open(9, 16),
        CLOSED,
      ],
      timeZone: SHOP_TIME_ZONE,
      locationStatus: LocationStatus.Active,
      sortOrder: 2,
      ...sure(GeoPoint.parse(42.46, 25.685), 'geo loc-mladost'),
      ...phone('+359887654321', '+359 88 765 4321'),
      ...NO_COVER,
    } satisfies Omit<ShopLocation, 'id'>,
  },
];

export const BOTH_LOCATIONS: readonly LocationId[] = [CENTER, MLADOST];

// ── The barbers ────────────────────────────────────────────────────────────

export const IVAN = BarberId.of('ivan');
export const NIKO = BarberId.of('niko');
export const STEFAN = BarberId.of('stefan');

/** A portrait the seed uploads from `apps/web/public/barbers/{file}`. */
export type SeededBarber = Seeded<BarberId, Barber> & { readonly file: string };

/** The avatar fields of a barber's portrait, at its deterministic path. */
function avatarOf(id: BarberId) {
  return {
    avatarMediaId: MediaRefId.of(`media-barber-${id}`),
    avatarMediaPath: `media/barbers/${id}.jpg`,
    // 4/5 portrait, the grid tiles' proportion.
    avatarMediaWidth: 1200,
    avatarMediaHeight: 1500,
    avatarMediaBlurhash: null,
    avatarMediaFocalX: null,
    avatarMediaFocalY: null,
  } as const;
}

/**
 * The roster the landing has been rendering from hand-authored content. No
 * `rating` on purpose ("fabricated ratings read as a scam"). `locationIds`
 * is populated rather than left empty (which would mean "every location"),
 * so the booking flow's per-location barber filter has a real negative
 * case: Stefan works the Center chair only.
 */
export const BARBERS: readonly SeededBarber[] = [
  {
    id: IVAN,
    file: 'ivan.jpg',
    body: {
      name: { bg: 'Иван Колев', en: 'Ivan Kolev' },
      handle: 'ivan',
      title: { bg: 'Главен бръснар', en: 'Chief barber' },
      bio: {
        bg: 'Дванадесет години на пода. Класическа ножична работа и чист skin фейд са неговата запазена марка.',
        en: 'Twelve years on the floor. Classic scissor work and a clean skin fade are his signature.',
      },
      yearsExperience: 12,
      locationIds: BOTH_LOCATIONS,
      instagramHandle: 'ivan.cuts',
      barberStatus: BarberStatus.Active,
      sortOrder: 1,
      ...avatarOf(IVAN),
    } satisfies Omit<Barber, 'id'>,
  },
  {
    id: NIKO,
    file: 'niko.jpg',
    body: {
      name: { bg: 'Нико Димов', en: 'Niko Dimov' },
      handle: 'niko',
      title: { bg: 'Бръснар', en: 'Barber' },
      bio: {
        bg: 'Човекът на фейда — градиенти толкова чисти, че ще се върнеш на момента.',
        en: "The fade man — gradients so clean you'll rebook on the spot.",
      },
      yearsExperience: 6,
      locationIds: BOTH_LOCATIONS,
      instagramHandle: 'niko.fades',
      barberStatus: BarberStatus.Active,
      sortOrder: 2,
      ...avatarOf(NIKO),
    } satisfies Omit<Barber, 'id'>,
  },
  {
    id: STEFAN,
    file: 'stefan.jpg',
    body: {
      name: { bg: 'Стефан Петров', en: 'Stefan Petrov' },
      handle: 'stefan',
      title: { bg: 'Бръснар', en: 'Barber' },
      bio: {
        bg: 'Бръсненето с права бръсначка и оформянето на брада са неговата територия.',
        en: 'Straight-razor shaves and beard shaping are his territory.',
      },
      yearsExperience: 8,
      locationIds: [CENTER],
      instagramHandle: 'stefan.razor',
      barberStatus: BarberStatus.Active,
      sortOrder: 3,
      ...avatarOf(STEFAN),
    } satisfies Omit<Barber, 'id'>,
  },
];

// ── The services ───────────────────────────────────────────────────────────

const SHORT = ServiceVariantId.of('short');
const LONG = ServiceVariantId.of('long');

/** Short vs long hair — the axis that actually moves a cut's price. */
export const LENGTH_VARIANTS: readonly ServiceVariant[] = [
  { variantId: SHORT, name: { bg: 'Къса коса', en: 'Short hair' } },
  { variantId: LONG, name: { bg: 'Дълга коса', en: 'Long hair' } },
];

/** One barber's terms for a service: their base, and the variants they price differently. */
function offering(
  barberId: BarberId,
  base: ServiceTerms,
  overrides: readonly (readonly [ServiceVariantId, ServiceTerms])[] = [],
): BarberOffering {
  return {
    barberId,
    overrides: overrides.map(([variantId, variantTerms]): VariantTerms => ({
      variantId,
      ...variantTerms,
    })),
    ...base,
  };
}

/**
 * The haircut family: one seat cannot hold two haircuts. Authored the way a
 * catalog manager would — each cut names the others it replaces.
 *
 * `svc-finish` is named BY the cuts but declares nothing itself: the
 * deliberate one-way case that proves the booking flow normalizes conflicts
 * symmetrically rather than trusting both directions to be authored.
 * Bundles declare nothing either — a bundle conflicts with everything it
 * holds implicitly, derived from its composition, never hand-authored.
 */
export const HAIRCUTS: readonly ServiceId[] = [
  ServiceId.of('svc-classic-cut'),
  ServiceId.of('svc-fade'),
  ServiceId.of('svc-scissor-trim'),
  ServiceId.of('svc-modern-cut'),
];
const FINISH = ServiceId.of('svc-finish');
const excluding = (id: string): readonly ServiceId[] => [
  ...HAIRCUTS.filter((other) => other !== id),
  FINISH,
];

/** A cover the seed uploads from `apps/web/public/work/{file}`. */
export type SeededService = Seeded<ServiceId, Service> & {
  readonly file: string;
};

/** What a service is before its cover: everything but the seven picture fields. */
type ServiceAuthored = Without<Body<Service>, keyof typeof NO_COVER>;

/**
 * ONE PHOTO, ONE OBJECT (wave D r6): a picture of the shop's library is
 * uploaded once, under the FIRST service that wears it, and every later
 * service with the same file wears that same object — the two bundles show
 * their first member's photo, one URL on every surface.
 */
function withCovers(
  authored: readonly {
    readonly id: string;
    readonly file: string;
    readonly body: ServiceAuthored;
  }[],
): readonly SeededService[] {
  const ownerOfFile = new Map<string, string>();
  return authored.map(({ id, file, body }) => {
    const owner = ownerOfFile.get(file) ?? id;
    ownerOfFile.set(file, owner);
    return {
      id: ServiceId.of(id),
      file,
      body: {
        ...body,
        coverMediaId: MediaRefId.of(`media-${owner}`),
        coverMediaPath: `media/services/${owner}.jpg`,
        // 4/5 portrait, the grid tiles' proportion.
        coverMediaWidth: 1200,
        coverMediaHeight: 1500,
        coverMediaBlurhash: null,
        coverMediaFocalX: null,
        coverMediaFocalY: null,
      } satisfies Omit<Service, 'id'>,
    };
  });
}

/** The fields every seeded service shares. */
const LISTED = {
  categoryId: CATEGORY.id,
  locationIds: [],
  upsellOnly: false,
  serviceStatus: ServiceStatus.Active,
} as const;

const text = (bg: string, en: string): LocalizedText => ({ bg, en });

export const SERVICES: readonly SeededService[] = withCovers([
  {
    id: 'svc-classic-cut',
    file: 'classic-clippers.jpg',
    body: {
      ...LISTED,
      name: text('Класическа подстрижка', 'Classic cut'),
      description: text(
        'Прецизна подстрижка с машинка и ножица, оформена по формата на главата — завършва с измиване и стайлинг.',
        'A precise clipper-and-scissor cut shaped to your head, finished with a wash and styling.',
      ),
      // The catalogue price before a barber or variant narrows it;
      // `offerings` never replace it, they refine it.
      ...terms(15, 45),
      variants: LENGTH_VARIANTS,
      offerings: [
        offering(IVAN, terms(14.5, 35), [
          [SHORT, terms(14.5, 35)],
          [LONG, terms(18.5, 50)],
        ]),
        offering(NIKO, terms(13, 30), [
          [SHORT, terms(13, 30)],
          [LONG, terms(16.5, 45)],
        ]),
        offering(STEFAN, terms(15, 45)),
      ],
      conflictsWith: excluding('svc-classic-cut'),
      popular: true,
      sortOrder: 1,
      ...ServiceComposition.single(),
    },
  },
  {
    id: 'svc-fade',
    file: 'fade-styling.jpg',
    body: {
      ...LISTED,
      name: text('Фейд', 'Skin fade'),
      description: text(
        'Плавен преход от кожа до желаната дължина — фейдът, който държи формата си седмици наред.',
        'A seamless skin-to-length gradient — the fade that holds its shape for weeks.',
      ),
      ...terms(17.5, 50),
      variants: [],
      offerings: [
        offering(NIKO, terms(15.5, 45)),
        offering(IVAN, terms(17.5, 50)),
        offering(STEFAN, terms(18, 55)),
      ],
      conflictsWith: excluding('svc-fade'),
      popular: true,
      sortOrder: 2,
      ...ServiceComposition.single(),
    },
  },
  {
    id: 'svc-beard',
    file: 'beard-shave.jpg',
    body: {
      ...LISTED,
      name: text('Оформяне на брада', 'Beard trim'),
      description: text(
        'Контуриране и оформяне на брадата с гореща кърпа и грижа за кожата под нея.',
        'Beard contouring and shaping with a hot towel and skincare underneath.',
      ),
      ...terms(10, 30),
      variants: [],
      offerings: [
        offering(STEFAN, terms(9, 25)),
        offering(IVAN, terms(10, 30)),
      ],
      conflictsWith: [],
      popular: false,
      sortOrder: 3,
      ...ServiceComposition.single(),
    },
  },
  {
    id: 'svc-scissor-trim',
    file: 'scissors-trim.jpg',
    body: {
      ...LISTED,
      name: text('Подстрижка с ножица', 'Scissor trim'),
      description: text(
        'Изцяло с ножица — за по-дълга коса и естествено падаща форма без машинка.',
        'Scissors only — for longer hair and a naturally falling shape, no clippers.',
      ),
      ...terms(20.5, 60),
      variants: LENGTH_VARIANTS,
      offerings: [
        offering(IVAN, terms(19, 55), [[LONG, terms(23, 70)]]),
        offering(STEFAN, terms(20.5, 60)),
      ],
      conflictsWith: excluding('svc-scissor-trim'),
      popular: false,
      sortOrder: 4,
      ...ServiceComposition.single(),
    },
  },
  {
    id: 'svc-modern-cut',
    file: 'modern-cut.jpg',
    body: {
      ...LISTED,
      name: text('Модерна визия', 'Modern restyle'),
      description: text(
        'Пълна промяна: консултация, нова форма и стайлинг съвети как да я поддържате у дома.',
        'A full restyle: consultation, a new shape, and styling tips to keep it up at home.',
      ),
      ...terms(23, 60),
      variants: [],
      offerings: [
        offering(IVAN, terms(23, 60)),
        offering(NIKO, terms(21.5, 55)),
      ],
      conflictsWith: excluding('svc-modern-cut'),
      popular: true,
      sortOrder: 5,
      ...ServiceComposition.single(),
    },
  },
  {
    id: 'svc-finish',
    file: 'finishing-touch.jpg',
    body: {
      ...LISTED,
      name: text('Освежаване', 'Finishing touch'),
      description: text(
        'Бързо освежаване между подстрижките — контури на врата, слепоочията и веждите.',
        'A quick refresh between cuts — neckline, temples and brow cleanup.',
      ),
      ...terms(7.5, 20),
      variants: [],
      offerings: [
        offering(IVAN, terms(7.5, 20)),
        offering(NIKO, terms(7.5, 20)),
        offering(STEFAN, terms(9, 25)),
      ],
      conflictsWith: [],
      popular: false,
      sortOrder: 6,
      ...ServiceComposition.single(),
    },
  },
  // ── Bundles: the shelf renders these in their own carousel with the
  // layers chip, and the detail sheet lists members with each one's price.
  {
    id: 'svc-full-care',
    file: 'classic-clippers.jpg',
    body: {
      ...LISTED,
      name: text('Пълна грижа', 'Full care'),
      description: text(
        'Подстрижка и оформяне на брада в един час — цялата визия, завършена наведнъж.',
        'A cut and a beard shape in one sitting — the whole look, finished at once.',
      ),
      ...terms(23, 70),
      variants: [],
      offerings: [
        offering(IVAN, terms(23, 70)),
        offering(STEFAN, terms(24.5, 75)),
      ],
      conflictsWith: [],
      popular: true,
      sortOrder: 7,
      ...ServiceComposition.bundle([
        ServiceId.of('svc-classic-cut'),
        ServiceId.of('svc-beard'),
      ]),
    },
  },
  {
    id: 'svc-father-son',
    file: 'modern-cut.jpg',
    body: {
      ...LISTED,
      name: text('Баща и син', 'Father & son'),
      description: text(
        'Два стола, един час — подстрижка за вас и за детето, без второ идване.',
        'Two chairs, one appointment — a cut for you and one for your kid, no second trip.',
      ),
      ...terms(21, 65),
      variants: [],
      offerings: [
        offering(NIKO, terms(21, 65)),
        offering(IVAN, terms(22.5, 70)),
      ],
      conflictsWith: [],
      popular: false,
      sortOrder: 8,
      ...ServiceComposition.bundle([ServiceId.of('svc-classic-cut'), FINISH]),
    },
  },
]);
