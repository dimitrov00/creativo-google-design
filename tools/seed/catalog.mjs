/**
 * The dev catalogue as DATA — shops, barbers, services and rosters — moved
 * out of `seed-dev-catalog.mjs` so the history generator can price a seat and
 * find a barber's hours without connecting to an emulator, and so a test can
 * read the same numbers the seed writes.
 *
 * Plain values only: the seed uploads the covers and avatars named by `file`
 * and writes the documents; nothing here touches Firebase.
 */

/** `LocationDayHours`, Mon-first ISO order — a 7-tuple is a type invariant. */
const open = (opens, closes) => ({ kind: 'open', opens, closes });
const CLOSED = { kind: 'closed' };

/**
 * The two shops, matching the hours the landing's locations section has been
 * rendering from hand-authored content. These exist so `/book` has something
 * to schedule against: `Location.hours` is the outer envelope every barber's
 * working hours are clamped to, and `timezone` replaces the `SCHEDULING_ZONE`
 * constant the booking use-case used to hardcode.
 */
export const LOCATIONS = [
  {
    id: 'loc-center',
    name: { bg: 'Креативо · Център', en: 'Creativo · Center' },
    // `Location.shortName`: the shop without the brand both shops carry, as
    // a visit row's fact line names it.
    shortName: { bg: 'Център', en: 'Center' },
    address: {
      bg: 'бул. „Цар Симеон Велики“ 120, Стара Загора',
      en: '120 Tsar Simeon Veliki Blvd, Stara Zagora',
    },
    phone: { e164: '+359881234567', display: '+359 88 123 4567' },
    geo: { lat: 42.4271, lng: 25.6366 },
    hours: [
      open('09:00', '20:00'),
      open('09:00', '20:00'),
      open('09:00', '20:00'),
      open('09:00', '20:00'),
      open('09:00', '21:00'),
      open('10:00', '18:00'),
      CLOSED,
    ],
    sortOrder: 1,
  },
  {
    id: 'loc-mladost',
    name: { bg: 'Креативо · Младост', en: 'Creativo · Mladost' },
    shortName: { bg: 'Младост', en: 'Mladost' },
    address: {
      bg: 'ул. „Армейска“ 14, Младост, Стара Загора',
      en: '14 Armeyska St, Mladost, Stara Zagora',
    },
    phone: { e164: '+359887654321', display: '+359 88 765 4321' },
    geo: { lat: 42.46, lng: 25.685 },
    hours: [
      CLOSED,
      open('10:00', '19:00'),
      open('10:00', '19:00'),
      open('10:00', '19:00'),
      open('10:00', '19:00'),
      open('09:00', '16:00'),
      CLOSED,
    ],
    sortOrder: 2,
  },
];

export const BOTH_LOCATIONS = LOCATIONS.map((location) => location.id);

/**
 * The roster the landing has been rendering from hand-authored content.
 * Seeded so both surfaces read one catalog — note `Barber` carries no
 * `rating` on purpose ("fabricated ratings read as a scam"), so the stars
 * the static content showed have no counterpart here.
 *
 * `locationIds` is populated rather than left empty (which would mean "every
 * location") so the booking flow's per-location barber filter has a real
 * negative case: Stefan works the Center chair only.
 */
export const BARBERS = [
  {
    id: 'ivan',
    file: 'ivan.jpg',
    handle: 'ivan',
    name: { bg: 'Иван Колев', en: 'Ivan Kolev' },
    title: { bg: 'Главен бръснар', en: 'Chief barber' },
    bio: {
      bg: 'Дванадесет години на пода. Класическа ножична работа и чист skin фейд са неговата запазена марка.',
      en: 'Twelve years on the floor. Classic scissor work and a clean skin fade are his signature.',
    },
    yearsExperience: 12,
    instagramHandle: 'ivan.cuts',
    locationIds: BOTH_LOCATIONS,
    sortOrder: 1,
  },
  {
    id: 'niko',
    file: 'niko.jpg',
    handle: 'niko',
    name: { bg: 'Нико Димов', en: 'Niko Dimov' },
    title: { bg: 'Бръснар', en: 'Barber' },
    bio: {
      bg: 'Човекът на фейда — градиенти толкова чисти, че ще се върнеш на момента.',
      en: "The fade man — gradients so clean you'll rebook on the spot.",
    },
    yearsExperience: 6,
    instagramHandle: 'niko.fades',
    locationIds: BOTH_LOCATIONS,
    sortOrder: 2,
  },
  {
    id: 'stefan',
    file: 'stefan.jpg',
    handle: 'stefan',
    name: { bg: 'Стефан Петров', en: 'Stefan Petrov' },
    title: { bg: 'Бръснар', en: 'Barber' },
    bio: {
      bg: 'Бръсненето с права бръсначка и оформянето на брада са неговата територия.',
      en: 'Straight-razor shaves and beard shaping are his territory.',
    },
    yearsExperience: 8,
    instagramHandle: 'stefan.razor',
    locationIds: ['loc-center'],
    sortOrder: 3,
  },
];

/** Short vs long hair — the axis that actually moves a cut's price. */
export const LENGTH_VARIANTS = [
  { id: 'short', name: { bg: 'Къса коса', en: 'Short hair' } },
  { id: 'long', name: { bg: 'Дълга коса', en: 'Long hair' } },
];

/** EUR minor units + minutes, the shape `BarberOffering` reconstitutes from. */
const terms = (major, minutes) => ({
  priceMinorUnits: Math.round(major * 100),
  currencyCode: 'EUR',
  durationMinutes: minutes,
});

/**
 * The haircut family: one seat cannot hold two haircuts. Authored the way a
 * catalog manager would — each cut names the others it replaces.
 *
 * `svc-finish` is named BY the cuts but declares nothing itself: it is the
 * deliberate one-way case that proves the booking flow normalizes conflicts
 * symmetrically rather than trusting both directions to be authored.
 * Bundles declare nothing either — a bundle conflicts with everything it
 * `includes` implicitly, derived from `composition`, never hand-authored.
 */
export const HAIRCUTS = [
  'svc-classic-cut',
  'svc-fade',
  'svc-scissor-trim',
  'svc-modern-cut',
];
const excluding = (id) => [
  ...HAIRCUTS.filter((other) => other !== id),
  'svc-finish',
];

export const CATEGORY = {
  id: 'cat-hair',
  name: { bg: 'Коса и брада', en: 'Hair & beard' },
  sortOrder: 1,
};

export const SERVICES = [
  {
    id: 'svc-classic-cut',
    conflictsWith: excluding('svc-classic-cut'),
    file: 'classic-clippers.jpg',
    name: { bg: 'Класическа подстрижка', en: 'Classic cut' },
    description: {
      bg: 'Прецизна подстрижка с машинка и ножица, оформена по формата на главата — завършва с измиване и стайлинг.',
      en: 'A precise clipper-and-scissor cut shaped to your head, finished with a wash and styling.',
    },
    priceMinorUnits: 1500,
    durationMinutes: 45,
    popular: true,
    variants: LENGTH_VARIANTS,
    offerings: [
      {
        barberId: 'ivan',
        base: terms(14.5, 35),
        byVariant: { short: terms(14.5, 35), long: terms(18.5, 50) },
      },
      {
        barberId: 'niko',
        base: terms(13, 30),
        byVariant: { short: terms(13, 30), long: terms(16.5, 45) },
      },
      { barberId: 'stefan', base: terms(15, 45) },
    ],
    sortOrder: 1,
  },
  {
    id: 'svc-fade',
    conflictsWith: excluding('svc-fade'),
    file: 'fade-styling.jpg',
    name: { bg: 'Фейд', en: 'Skin fade' },
    description: {
      bg: 'Плавен преход от кожа до желаната дължина — фейдът, който държи формата си седмици наред.',
      en: 'A seamless skin-to-length gradient — the fade that holds its shape for weeks.',
    },
    priceMinorUnits: 1750,
    durationMinutes: 50,
    popular: true,
    variants: [],
    offerings: [
      { barberId: 'niko', base: terms(15.5, 45) },
      { barberId: 'ivan', base: terms(17.5, 50) },
      { barberId: 'stefan', base: terms(18, 55) },
    ],
    sortOrder: 2,
  },
  {
    id: 'svc-beard',
    file: 'beard-shave.jpg',
    name: { bg: 'Оформяне на брада', en: 'Beard trim' },
    description: {
      bg: 'Контуриране и оформяне на брадата с гореща кърпа и грижа за кожата под нея.',
      en: 'Beard contouring and shaping with a hot towel and skincare underneath.',
    },
    priceMinorUnits: 1000,
    durationMinutes: 30,
    popular: false,
    variants: [],
    offerings: [
      { barberId: 'stefan', base: terms(9, 25) },
      { barberId: 'ivan', base: terms(10, 30) },
    ],
    sortOrder: 3,
  },
  {
    id: 'svc-scissor-trim',
    conflictsWith: excluding('svc-scissor-trim'),
    file: 'scissors-trim.jpg',
    name: { bg: 'Подстрижка с ножица', en: 'Scissor trim' },
    description: {
      bg: 'Изцяло с ножица — за по-дълга коса и естествено падаща форма без машинка.',
      en: 'Scissors only — for longer hair and a naturally falling shape, no clippers.',
    },
    priceMinorUnits: 2050,
    durationMinutes: 60,
    popular: false,
    variants: LENGTH_VARIANTS,
    offerings: [
      {
        barberId: 'ivan',
        base: terms(19, 55),
        byVariant: { long: terms(23, 70) },
      },
      { barberId: 'stefan', base: terms(20.5, 60) },
    ],
    sortOrder: 4,
  },
  {
    id: 'svc-modern-cut',
    conflictsWith: excluding('svc-modern-cut'),
    file: 'modern-cut.jpg',
    name: { bg: 'Модерна визия', en: 'Modern restyle' },
    description: {
      bg: 'Пълна промяна: консултация, нова форма и стайлинг съвети как да я поддържате у дома.',
      en: 'A full restyle: consultation, a new shape, and styling tips to keep it up at home.',
    },
    priceMinorUnits: 2300,
    durationMinutes: 60,
    popular: true,
    variants: [],
    offerings: [
      { barberId: 'ivan', base: terms(23, 60) },
      { barberId: 'niko', base: terms(21.5, 55) },
    ],
    sortOrder: 5,
  },
  {
    id: 'svc-finish',
    file: 'finishing-touch.jpg',
    name: { bg: 'Освежаване', en: 'Finishing touch' },
    description: {
      bg: 'Бързо освежаване между подстрижките — контури на врата, слепоочията и веждите.',
      en: 'A quick refresh between cuts — neckline, temples and brow cleanup.',
    },
    priceMinorUnits: 750,
    durationMinutes: 20,
    popular: false,
    variants: [],
    offerings: [
      { barberId: 'ivan', base: terms(7.5, 20) },
      { barberId: 'niko', base: terms(7.5, 20) },
      { barberId: 'stefan', base: terms(9, 25) },
    ],
    sortOrder: 6,
  },
  // ── Bundles ──────────────────────────────────────────────────────────
  // `includes` names the member services; the shelf renders these in their
  // own carousel with the layers chip, and the detail sheet lists members
  // with each one's own price.
  {
    id: 'svc-full-care',
    file: 'classic-clippers.jpg',
    name: { bg: 'Пълна грижа', en: 'Full care' },
    description: {
      bg: 'Подстрижка и оформяне на брада в един час — цялата визия, завършена наведнъж.',
      en: 'A cut and a beard shape in one sitting — the whole look, finished at once.',
    },
    priceMinorUnits: 2300,
    durationMinutes: 70,
    popular: true,
    kind: 'bundle',
    includes: ['svc-classic-cut', 'svc-beard'],
    variants: [],
    offerings: [
      { barberId: 'ivan', base: terms(23, 70) },
      { barberId: 'stefan', base: terms(24.5, 75) },
    ],
    sortOrder: 7,
  },
  {
    id: 'svc-father-son',
    file: 'modern-cut.jpg',
    name: { bg: 'Баща и син', en: 'Father & son' },
    description: {
      bg: 'Два стола, един час — подстрижка за вас и за детето, без второ идване.',
      en: 'Two chairs, one appointment — a cut for you and one for your kid, no second trip.',
    },
    priceMinorUnits: 2100,
    durationMinutes: 65,
    popular: false,
    kind: 'bundle',
    includes: ['svc-classic-cut', 'svc-finish'],
    variants: [],
    offerings: [
      { barberId: 'niko', base: terms(21, 65) },
      { barberId: 'ivan', base: terms(22.5, 70) },
    ],
    sortOrder: 8,
  },
];

/**
 * Barber rosters.
 *
 * Every shift segment carries **its own location**, because a barber is not a
 * fixture of one chair: Ivan covers Center most of the week and Mladost on
 * Fridays, and Niko splits a single Wednesday between the two. That is ordinary
 * in a two-shop business, and the first model — one `locationId` per barber —
 * could not say it at all.
 *
 * Several segments per weekday also express a lunch break, which the original
 * one-range-per-day model could not. `turnaroundMinutes` is the barber's
 * baseline reset between UNRELATED clients — never applied between two seats of
 * one party.
 *
 * `effectiveFrom` is what makes an hours change safe: amending a roster appends
 * a new version rather than rewriting this one, so historical utilisation keeps
 * dividing by the hours that were actually worked.
 */
export const CENTER = 'loc-center';
export const MLADOST = 'loc-mladost';

/** A split shift at one shop — mornings, lunch, afternoons. */
const shiftAt = (locationId) => [
  { start: '09:00', end: '13:00', locationId },
  { start: '14:00', end: '18:00', locationId },
];

const LATE_SHIFT_CENTER = [
  { start: '12:00', end: '20:00', locationId: CENTER },
];

export const SCHEDULES = [
  {
    barberId: 'ivan',
    turnaroundMinutes: 10,
    weeklyPattern: {
      monday: shiftAt(CENTER),
      tuesday: shiftAt(CENTER),
      wednesday: shiftAt(CENTER),
      thursday: shiftAt(CENTER),
      // Ivan covers the Mladost chair on Fridays. Mladost opens 10:00–19:00,
      // so the morning segment starts with the shop rather than at 09:00 —
      // otherwise the first hour clips away and the roster reads as a lie.
      friday: [
        { start: '10:00', end: '13:00', locationId: MLADOST },
        { start: '14:00', end: '18:00', locationId: MLADOST },
      ],
      saturday: [{ start: '10:00', end: '16:00', locationId: CENTER }],
    },
  },
  {
    barberId: 'niko',
    turnaroundMinutes: 0,
    weeklyPattern: {
      tuesday: LATE_SHIFT_CENTER,
      // The headline case: ONE day, TWO shops. Center in the morning, Mladost
      // in the afternoon, with two hours between them — comfortably more than
      // anyone needs to cross Stara Zagora, so the pattern is workable.
      wednesday: [
        { start: '09:00', end: '13:00', locationId: CENTER },
        { start: '15:00', end: '19:00', locationId: MLADOST },
      ],
      thursday: LATE_SHIFT_CENTER,
      friday: LATE_SHIFT_CENTER,
      saturday: [{ start: '10:00', end: '18:00', locationId: CENTER }],
    },
  },
  {
    // Stefan works the Center chair only, and takes Wednesdays off — so a
    // Wednesday party asking for him has no options, which is a state the
    // schedule step has to render honestly rather than as a blank grid.
    barberId: 'stefan',
    turnaroundMinutes: 15,
    weeklyPattern: {
      monday: shiftAt(CENTER),
      tuesday: shiftAt(CENTER),
      thursday: shiftAt(CENTER),
      friday: shiftAt(CENTER),
      saturday: [{ start: '09:00', end: '15:00', locationId: CENTER }],
    },
  },
];

const WEEKDAY_NAMES = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
];

const minutesOf = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

/**
 * A barber's BOOKABLE segments on a weekday (0 = Sunday), as minutes of the
 * day: the roster's segments clamped to their shop's hours that day, the
 * outer envelope the booking flow clamps every window to. Stefan's Saturday
 * 09:00 start meets a Center that opens at 10:00, so his Saturday is sold
 * from 10:00, and so is it seeded.
 */
export function segmentsOn(barberId, weekday) {
  const schedule = SCHEDULES.find((entry) => entry.barberId === barberId);
  const segments = schedule?.weeklyPattern[WEEKDAY_NAMES[weekday]] ?? [];
  return segments.flatMap(({ start, end, locationId }) => {
    const location = LOCATIONS.find((entry) => entry.id === locationId);
    // `hours` is Monday-first; `weekday` counts from Sunday.
    const day = location?.hours[(weekday + 6) % 7];
    if (!day || day.kind !== 'open') return [];
    const startMinute = Math.max(minutesOf(start), minutesOf(day.opens));
    const endMinute = Math.min(minutesOf(end), minutesOf(day.closes));
    return endMinute > startMinute
      ? [{ startMinute, endMinute, locationId }]
      : [];
  });
}

/**
 * The earliest a published exception is placed: past the day fixtures'
 * days (at most four, `buildClientBook`'s `appointmentDays`), so no fixture
 * has to move around it.
 */
export const EXCEPTION_EARLIEST_OFFSET = 5;

/**
 * The first day from `from` on that `barberId`'s roster works, as a day
 * offset on `calendar`, and the shop the roster puts them in that day.
 * Every barber works some day of any week, so a week always finds one.
 */
function firstWorkedDay(barberId, calendar, from) {
  for (let offset = from; offset < from + 7; offset++) {
    const [segment] = segmentsOn(barberId, calendar.weekdayAt(offset));
    if (segment) return { dayOffset: offset, locationId: segment.locationId };
  }
  throw new Error(`seed: ${barberId} works no day of the week from ${from}`);
}

/** One answer per calendar: `segmentsAt` asks for every day of the history. */
const exceptionsByCalendar = new WeakMap();

/**
 * The published schedule exceptions on the shop's `calendar`, by day offset
 * from its today. One for now: Stefan is off on the first day from
 * {@link EXCEPTION_EARLIEST_OFFSET} on that his ROSTER works, so the
 * calendar visibly greys a day the roster says is worked — if it stops
 * greying, the exception pipeline broke. A fixed offset could not promise
 * that: on a Tuesday +5 is a Sunday and on a Friday a Wednesday, both his
 * days off anyway, where the greyed day told nothing apart from the roster.
 *
 * The seed writes these; `segmentsAt` (and so every placement) and the
 * specs read the same answer.
 */
export function scheduleExceptionsFor(calendar) {
  let exceptions = exceptionsByCalendar.get(calendar);
  if (!exceptions) {
    exceptions = Object.freeze([
      Object.freeze({
        barberId: 'stefan',
        ...firstWorkedDay('stefan', calendar, EXCEPTION_EARLIEST_OFFSET),
        effect: Object.freeze({ kind: 'closed' }),
      }),
    ]);
    exceptionsByCalendar.set(calendar, exceptions);
  }
  return exceptions;
}

/**
 * A barber's bookable segments on one day of the shop's `calendar` — the
 * weekly roster, unless an exception closes that day.
 */
export function segmentsAt(barberId, calendar, dayOffset) {
  const closed = scheduleExceptionsFor(calendar).some(
    (exception) =>
      exception.barberId === barberId &&
      exception.dayOffset === dayOffset &&
      exception.effect.kind === 'closed',
  );
  return closed ? [] : segmentsOn(barberId, calendar.weekdayAt(dayOffset));
}

/**
 * A barber's reset between UNRELATED clients — the padding `commitBooking`
 * puts around every busy interval of that chair before it will place a seat
 * (`checkPlacement`). Never applied between two seats of one party.
 */
export function turnaroundMinutesOf(barberId) {
  const schedule = SCHEDULES.find((entry) => entry.barberId === barberId);
  if (!schedule) throw new Error(`seed: no roster for ${barberId}`);
  return schedule.turnaroundMinutes;
}

/**
 * The chair's own terms for a service and variant — the price a seat is
 * SOLD at. A seat used to be seeded at a flat 28,00 € whatever the service,
 * so every seeded visit read as custom-priced («по договорка») on the staff
 * sheet (owner, 2026-09-10).
 *
 * Refuses a barber the service has no offering for, for EVERY fixture. The
 * hand-authored day fixtures used to fall back to the first offering, so
 * `appt-dev-3` sat Нико on a beard he does not sell, priced at Стефан's
 * terms, on the staff screens and in Петър's stats (2026-09-25). A seat the
 * booking flow could not have sold now stops the seed before its first write.
 */
export function chairTerms(serviceId, barberId, variantId) {
  const service = SERVICES.find((entry) => entry.id === serviceId);
  if (!service) throw new Error(`seed: no service ${serviceId}`);
  // NO ILLEGAL SEATS (owner, 2026-09-10): a service with variants is only
  // ever sold per variant — the callable refuses a bare seat on it, and the
  // seeder, which writes past the callable, must refuse it too.
  if (service.variants.length > 0 && !variantId) {
    throw new Error(
      `seed: ${serviceId} has variants — the seat must choose one`,
    );
  }
  if (
    variantId &&
    !service.variants.some((variant) => variant.id === variantId)
  ) {
    throw new Error(`seed: ${serviceId} has no variant ${variantId}`);
  }
  const offering = service.offerings.find(
    (entry) => entry.barberId === barberId,
  );
  if (!offering) {
    throw new Error(`seed: ${barberId} does not offer ${serviceId}`);
  }
  return (variantId && offering.byVariant?.[variantId]) || offering.base;
}
