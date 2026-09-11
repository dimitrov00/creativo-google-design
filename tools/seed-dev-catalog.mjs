/**
 * Seeds the Firebase EMULATORS with a small barbershop catalog so the
 * onboarding services grid (and anything else reading `CatalogReader`) has
 * real data to render in dev: one category, six single services and two
 * bundles with cover art uploaded to the Storage emulator from
 * `apps/web/public/work/`, plus the two shop `locations` the booking flow
 * schedules against.
 *
 * The haircut family carries REAL `conflictsWith` data (a seat cannot hold
 * two haircuts) — `svc-finish` is deliberately left one-way so the booking
 * flow's symmetric conflict normalization is exercised against seeded data
 * rather than only in unit tests.
 *
 * Emulator-only by construction: refuses to run unless
 * FIRESTORE_EMULATOR_HOST is set, so it can never touch a real project.
 * Idempotent — fixed doc ids, `set()` overwrites.
 *
 * Run with the dev stack up (`pnpm run dev`):
 *   pnpm run seed:dev
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import admin from 'firebase-admin';

process.env.FIRESTORE_EMULATOR_HOST ??= '127.0.0.1:8080';
process.env.FIREBASE_STORAGE_EMULATOR_HOST ??= '127.0.0.1:9199';

const PROJECT_ID = 'demo-creativo-test';
const BUCKET = 'demo-creativo-test.appspot.com';

if (!process.env.FIRESTORE_EMULATOR_HOST.includes('127.0.0.1')) {
  console.error('Refusing to run outside the local emulators.');
  process.exit(1);
}

process.env.FIREBASE_AUTH_EMULATOR_HOST ??= '127.0.0.1:9099';

admin.initializeApp({ projectId: PROJECT_ID, storageBucket: BUCKET });
const db = admin.firestore();
const bucket = admin.storage().bucket();

const publicDir = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'apps/web/public',
);
const workDir = join(publicDir, 'work');
const barbersDir = join(publicDir, 'barbers');

/** Uploads one local jpg into the Storage emulator, returns its MediaRef doc shape. */
async function uploadCover(file, id) {
  const path = `media/services/${id}.jpg`;
  await bucket.file(path).save(readFileSync(join(workDir, file)), {
    contentType: 'image/jpeg',
  });
  // 4/5 portrait dimensions matching the grid tiles; the media reader only
  // forwards width as the variant width, exactness is not required.
  return { id: `media-${id}`, path, width: 1200, height: 1500 };
}

async function uploadAvatar(file, id) {
  const path = `media/barbers/${id}.jpg`;
  await bucket.file(path).save(readFileSync(join(barbersDir, file)), {
    contentType: 'image/jpeg',
  });
  return { id: `media-barber-${id}`, path, width: 1200, height: 1500 };
}

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
const LOCATIONS = [
  {
    id: 'loc-center',
    name: { bg: 'Креативо · Център', en: 'Creativo · Center' },
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

const BOTH_LOCATIONS = LOCATIONS.map((location) => location.id);

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
const BARBERS = [
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
const LENGTH_VARIANTS = [
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
const HAIRCUTS = [
  'svc-classic-cut',
  'svc-fade',
  'svc-scissor-trim',
  'svc-modern-cut',
];
const excluding = (id) => [
  ...HAIRCUTS.filter((other) => other !== id),
  'svc-finish',
];

const CATEGORY = {
  id: 'cat-hair',
  name: { bg: 'Коса и брада', en: 'Hair & beard' },
  sortOrder: 1,
};

const SERVICES = [
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

await db
  .collection('serviceCategories')
  .doc(CATEGORY.id)
  .set({ name: CATEGORY.name, sortOrder: CATEGORY.sortOrder });

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
const CENTER = 'loc-center';
const MLADOST = 'loc-mladost';

/** A split shift at one shop — mornings, lunch, afternoons. */
const shiftAt = (locationId) => [
  { start: '09:00', end: '13:00', locationId },
  { start: '14:00', end: '18:00', locationId },
];

const LATE_SHIFT_CENTER = [
  { start: '12:00', end: '20:00', locationId: CENTER },
];

const SCHEDULES = [
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

/**
 * Firestore forbids DIRECTLY-NESTED ARRAYS, so a weekday's segments are stored
 * as an array of maps — which is also the only shape that can carry a location
 * per segment. This and the two adapters' `toPatternProps` are the only places
 * that know the persisted shape.
 */
function toStoredPattern(weeklyPattern) {
  return Object.fromEntries(
    Object.entries(weeklyPattern).map(([weekday, segments]) => [
      weekday,
      segments.map(({ start, end, locationId }) => ({
        start,
        end,
        locationId,
      })),
    ]),
  );
}

// Locations FIRST: seeding a roster fires the capacity trigger, which
// clamps windows to shop hours — hours that must already exist or the
// first materialization computes unclamped days.
for (const location of LOCATIONS) {
  await db.collection('locations').doc(location.id).set({
    name: location.name,
    address: location.address,
    phone: location.phone,
    geo: location.geo,
    hours: location.hours,
    // Every slot the booking flow computes is materialized against this
    // zone, never the device's — the §7.1 rule that a UTC server or a
    // travelling client must still land on the shop's own calendar day.
    timezone: 'Europe/Sofia',
    status: 'active',
    sortOrder: location.sortOrder,
  });
  console.log(`seeded location ${location.id}`);
}

for (const schedule of SCHEDULES) {
  await db
    .collection('barberSchedules')
    .doc(schedule.barberId)
    .set({
      barberId: schedule.barberId,
      // NO document-level `locationId`: the location lives on each segment, so
      // one barber's week can span shops. Ask the pattern where they work.
      turnaroundMinutes: schedule.turnaroundMinutes,
      // One open-ended version. `amend` closes it and appends the next.
      versions: [
        {
          seq: 0,
          effectiveFrom: '2026-01-01',
          effectiveTo: null,
          weeklyPattern: toStoredPattern(schedule.weeklyPattern),
        },
      ],
    });
  console.log(`seeded schedule for ${schedule.barberId}`);
}

/**
 * The PUBLIC busy projection — geometry only, no reason, no ids, no revenue.
 *
 * Firestore rules cannot redact fields, so anything an anonymous visitor may
 * read has to live in a document that simply does not contain the secret.
 * Intervals are merged, which leaks booking density (what anyone learns by
 * looking through the window) but never how many clients were served.
 *
 * Seeded here so the schedule step has a realistically busy shop to render
 * against; in production the `commitBooking` transaction writes it.
 */
const SCHEDULING_ZONE = 'Europe/Sofia';

/**
 * A wall-clock time on the shop's day, as an ISO string carrying Sofia's
 * OFFSET — the same shape `commitBooking` writes.
 *
 * The first pass used `toISOString()`, which is a correct instant but reads
 * as UTC: `10:00` Sofia came back as `07:00Z`, and every hand-check of the
 * projection was three hours out. Both parse to the same instant, but one
 * shape beats two, and the readable one wins.
 */
function isoAt(dayOffset, hour, minute) {
  const base = new Date();
  base.setHours(0, 0, 0, 0);
  base.setDate(base.getDate() + dayOffset);
  base.setHours(hour, minute, 0, 0);

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: SCHEDULING_ZONE,
    timeZoneName: 'longOffset',
  })
    .formatToParts(base)
    .find((part) => part.type === 'timeZoneName');
  // `GMT+03:00` → `+03:00`; `GMT` (never in Sofia) → `Z`.
  const offset = (parts?.value ?? 'GMT').replace('GMT', '') || 'Z';

  const pad = (n) => String(n).padStart(2, '0');
  const day = [
    base.getFullYear(),
    pad(base.getMonth() + 1),
    pad(base.getDate()),
  ].join('-');
  return `${day}T${pad(hour)}:${pad(minute)}:00.000${offset}`;
}

const BUSY_PATTERN = {
  ivan: [
    [10, 0, 10, 45],
    [15, 0, 16, 0],
  ],
  niko: [
    [13, 0, 13, 45],
    [17, 30, 18, 15],
  ],
  stefan: [[11, 0, 11, 45]],
};

const BUSY_HORIZON_DAYS = 21;

/**
 * How many days from today are seeded with REAL appointments.
 *
 * Those days get their `barberBusy` from the `rebuildBusyOnAppointmentChange`
 * trigger instead of the fabrication below, so the two surfaces cannot
 * disagree — see the appointments block near the end of this file.
 */
const APPOINTMENT_DAYS = 3;

for (const schedule of SCHEDULES) {
  // eslint-disable-next-line security/detect-object-injection -- fixed keys.
  const pattern = BUSY_PATTERN[schedule.barberId] ?? [];
  for (let offset = APPOINTMENT_DAYS; offset < BUSY_HORIZON_DAYS; offset++) {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() + offset);
    const dayKey = [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, '0'),
      String(date.getDate()).padStart(2, '0'),
    ].join('-');

    // Vary the load so the calendar's per-day markers are not uniform — a
    // grid where every day looks identical proves nothing.
    const density = (offset * 7 + schedule.barberId.length) % 3;
    const busy = pattern
      .slice(0, density === 0 ? pattern.length : density)
      .map(([fromH, fromM, toH, toM]) => ({
        startIso: isoAt(offset, fromH, fromM),
        endIso: isoAt(offset, toH, toM),
      }));

    await db
      .collection('barberBusy')
      .doc(`${schedule.barberId}__${dayKey}`)
      .set({
        barberId: schedule.barberId,
        dayKey,
        zone: SCHEDULING_ZONE,
        busy,
      });
  }
  console.log(
    `seeded busy days ${APPOINTMENT_DAYS}..${BUSY_HORIZON_DAYS} for ${schedule.barberId}` +
      ' (earlier days come from real appointments)',
  );
}

/*
 * One published schedule exception: Stefan is off five days from now.
 *
 * The SANITIZED public doc — effect only, structurally no reason field (the
 * domain's `sick`/`training` reasons are staff-only data and must never be
 * derivable from the anonymous surface). Seeded so the calendar visibly
 * greys a day the roster says is worked; if it stops greying, the exception
 * pipeline broke.
 */
{
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + 5);
  const dayKey = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
  await db
    .collection('scheduleExceptions')
    .doc(`stefan__${dayKey}`)
    .set({
      barberId: 'stefan',
      dayKey,
      zone: SCHEDULING_ZONE,
      locationId: 'loc-center',
      effect: { kind: 'closed' },
    });
  console.log(`seeded scheduleExceptions/stefan__${dayKey} (closed)`);
}

for (const barber of BARBERS) {
  const avatar = await uploadAvatar(barber.file, barber.id);
  await db.collection('barbers').doc(barber.id).set({
    name: barber.name,
    handle: barber.handle,
    title: barber.title,
    bio: barber.bio,
    avatar,
    yearsExperience: barber.yearsExperience,
    locationIds: barber.locationIds,
    instagramHandle: barber.instagramHandle,
    status: 'active',
    sortOrder: barber.sortOrder,
  });
  console.log(`seeded barber ${barber.id}`);
}

for (const service of SERVICES) {
  const cover = await uploadCover(service.file, service.id);
  await db
    .collection('services')
    .doc(service.id)
    .set({
      name: service.name,
      description: service.description,
      categoryId: CATEGORY.id,
      // Base terms — the catalog price before a barber or variant narrows
      // it. `offerings` below never replace this, they refine it.
      priceMinorUnits: service.priceMinorUnits,
      currencyCode: 'EUR',
      durationMinutes: service.durationMinutes,
      variants: service.variants,
      offerings: service.offerings,
      cover,
      locationIds: [],
      conflictsWith: service.conflictsWith ?? [],
      composition:
        service.kind === 'bundle'
          ? { kind: 'bundle', includes: service.includes }
          : { kind: 'single' },
      upsellOnly: false,
      popular: service.popular,
      status: 'active',
      sortOrder: service.sortOrder,
    });
  console.log(
    `seeded ${service.id} (${service.offerings.length} offerings, ${service.variants.length} variants)`,
  );
}

/*
 * The tenant policy document, at its shipping defaults.
 *
 * Seeded EXPLICITLY even though every reader falls back to the same numbers,
 * because a missing doc and a read defaults are indistinguishable on screen —
 * which is precisely how the client's broken policy parse went unnoticed.
 * With a real doc in the emulator, changing a number here must visibly move
 * the calendar horizon; if it doesn't, the wiring broke again.
 *
 * Field values mirror `BookingPolicy.default()` (`libs/domain/scheduling`);
 * the shape is owned by `booking-policy-document.ts` in application/booking.
 */
await db.collection('settings').doc('bookingPolicy').set({
  maxPartySize: 5,
  slotStepMinutes: 15,
  minLeadMinutes: 120,
  horizonMonths: 2,
  cancellationWindowHours: 24,
  maxFlexibleDays: 7,
});
console.log('seeded settings/bookingPolicy');

/**
 * A STAFF account, so /staff is reachable in dev at all.
 *
 * Only the users doc matters: `verifyOtpChallenge` finds the account by
 * email, reads `roles` off the doc (rules make that field Admin-SDK-only),
 * and mints them into the token — `signInWithCustomToken` then creates the
 * Auth user on first sign-in by itself. Sign in as staff@test.local; the
 * OTP prints to the emulator log like every dev sign-in.
 */
const STAFF_UID = 'dev-staff-ivan';
/**
 * The same prefixes `FirestoreProfileAdapter` / the functions' user repository
 * write: every prefix of every name token, phone digits (E.164 without the
 * plus, and the national `0…` form) and the email from the 3rd character.
 * Kept in lockstep by hand — the seed is plain JS and cannot import them.
 */
function searchFields(firstName, lastName, phone, email) {
  const searchName = `${firstName} ${lastName}`.trim().toLowerCase();
  const out = new Set();
  const prefixes = (token, from = 1) => {
    for (let i = from; i <= token.length; i += 1) out.add(token.slice(0, i));
  };
  for (const token of searchName.split(/\s+/).filter(Boolean)) prefixes(token);
  const digits = phone.replace(/\D/g, '');
  prefixes(digits, 3);
  if (digits.startsWith('359')) prefixes('0' + digits.slice(3), 3);
  if (email) {
    const lower = email.toLowerCase();
    prefixes(lower, 3);
    prefixes(lower.split('@')[0], 3);
  }
  return { searchName, searchPrefixes: [...out] };
}

await db.doc(`users/${STAFF_UID}`).set({
  phone: '+35943012399',
  firstName: 'Иван',
  lastName: 'Колев',
  roles: ['barber', 'admin'],
  status: { kind: 'active' },
  email: 'staff@test.local',
  birthDate: null,
  ...searchFields('Иван', 'Колев', '+35943012399', 'staff@test.local'),
});
console.log('seeded staff account: staff@test.local (barber+admin)');

/*
 * THE SEEDED CLIENTS get a profile document too (owner, 2026-09-09), so the
 * desk's client search — by name, number or mail — has somebody to find.
 * Names and numbers are the same ones their seeded bookings carry.
 */
const CLIENT_PROFILES = [
  ['dev-client-1', 'Георги', 'Петров', '+359881234567', 'georgi@test.local'],
  ['dev-client-2', 'Мартин', 'Илиев', '+359887654321', 'martin@test.local'],
  ['dev-client-3', 'Петър', 'Димитров', '+359882223344', 'petar@test.local'],
  ['dev-client-4', 'Стоян', 'Колев', '+359881112233', null],
  ['dev-client-7', 'Александър', 'Стоянов', '+359887778899', null],
];
for (const [uid, firstName, lastName, phone, email] of CLIENT_PROFILES) {
  await db.doc(`users/${uid}`).set({
    phone,
    firstName,
    lastName,
    roles: ['client'],
    status: { kind: 'active' },
    email,
    birthDate: null,
    ...searchFields(firstName, lastName, phone, email),
  });
}
console.log(`seeded ${CLIENT_PROFILES.length} client profiles`);

/*
 * PROMOTIONS (2026-09-10): what the visit sheet's «Отстъпка» row can offer.
 * Two coupons open by CODE at the counter (`FIRST10`, `BEARD5`) and two reach
 * clients only as GRANTS — Мартин (today's 12:30 chair) holds a birthday
 * −20%, Петър a free fifth cut, and Мартин also holds one already USED so the
 * sheet can be seen filtering it out. The document vocabulary is the
 * engagement adapter's own (`coupon-persistence.ts`), value included.
 */
const COUPONS = [
  {
    id: 'coupon-first10',
    name: 'Първо посещение',
    code: 'FIRST10',
    value: { kind: 'percent_off', percent: 10 },
    combinability: { kind: 'stackable' },
    expiry: { kind: 'never' },
    enabled: true,
  },
  {
    id: 'coupon-beard5',
    name: 'Брада −5 €',
    code: 'BEARD5',
    value: { kind: 'fixed_amount', amountMinorUnits: 500, currencyCode: 'EUR' },
    combinability: { kind: 'stackable' },
    expiry: { kind: 'never' },
    enabled: true,
  },
  {
    id: 'coupon-retired',
    name: 'Лятна промоция',
    code: 'SUMMER',
    value: { kind: 'percent_off', percent: 15 },
    combinability: { kind: 'stackable' },
    expiry: { kind: 'never' },
    // Retired: the code must read as "no such code" at the counter.
    enabled: false,
  },
  {
    id: 'coupon-birthday',
    name: 'Рожден ден',
    code: null,
    value: { kind: 'percent_off', percent: 20 },
    combinability: { kind: 'exclusive' },
    expiry: { kind: 'days', days: 30 },
    enabled: true,
  },
  {
    id: 'coupon-fifth-cut',
    name: 'Пето подстригване',
    code: null,
    value: { kind: 'free_service' },
    combinability: { kind: 'exclusive' },
    expiry: { kind: 'never' },
    enabled: true,
  },
];
for (const coupon of COUPONS) {
  const { id, ...data } = coupon;
  await db.collection('coupons').doc(id).set(data);
}

const grantedAtIso = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
const COUPON_GRANTS = [
  {
    id: 'grant-dev-martin-birthday',
    userId: 'dev-client-2',
    couponId: 'coupon-birthday',
    value: { kind: 'percent_off', percent: 20 },
    grantedAt: grantedAtIso,
    state: {
      kind: 'active',
      capacity: { kind: 'single_use' },
      expiration: { kind: 'no_expiry' },
    },
  },
  {
    id: 'grant-dev-martin-used',
    userId: 'dev-client-2',
    couponId: 'coupon-first10',
    value: { kind: 'percent_off', percent: 10 },
    grantedAt: grantedAtIso,
    state: { kind: 'used', usedAtIso: grantedAtIso, note: 'seed' },
  },
  {
    id: 'grant-dev-petar-fifth',
    userId: 'dev-client-3',
    couponId: 'coupon-fifth-cut',
    value: { kind: 'free_service' },
    grantedAt: grantedAtIso,
    state: {
      kind: 'active',
      capacity: { kind: 'single_use' },
      expiration: { kind: 'no_expiry' },
    },
  },
];
for (const grant of COUPON_GRANTS) {
  const { id, ...data } = grant;
  await db.collection('couponGrants').doc(id).set({ id, ...data });
}
console.log(`seeded ${COUPONS.length} coupons and ${COUPON_GRANTS.length} grants`);

/*
 * GIFT VOUCHERS (2026-09-10): money already paid, drawn down by visits.
 * `GIFT2025` (25 €) is Мартин's, `GIFT5` (5 €) belongs to nobody in
 * particular, `EMPTY001` was spent — the sheet must say so, not "no such
 * code". The document vocabulary is `gift-voucher-document.ts`'s.
 */
const issuedAtIso = grantedAtIso;
const GIFT_VOUCHERS = [
  {
    id: 'voucher-dev-martin',
    code: 'GIFT2025',
    initialValueMinorUnits: 2500,
    balanceMinorUnits: 2500,
    currencyCode: 'EUR',
    issuedAt: { iso: issuedAtIso, zone: 'Europe/Sofia' },
    expiresAt: null,
    issuedToUserId: 'dev-client-2',
    state: { kind: 'active' },
  },
  {
    id: 'voucher-dev-five',
    code: 'GIFT5',
    initialValueMinorUnits: 500,
    balanceMinorUnits: 500,
    currencyCode: 'EUR',
    issuedAt: { iso: issuedAtIso, zone: 'Europe/Sofia' },
    expiresAt: null,
    issuedToUserId: null,
    state: { kind: 'active' },
  },
  {
    id: 'voucher-dev-empty',
    code: 'EMPTY001',
    initialValueMinorUnits: 1000,
    balanceMinorUnits: 0,
    currencyCode: 'EUR',
    issuedAt: { iso: issuedAtIso, zone: 'Europe/Sofia' },
    expiresAt: null,
    issuedToUserId: null,
    state: { kind: 'active' },
  },
];
for (const voucher of GIFT_VOUCHERS) {
  const { id, ...data } = voucher;
  await db.collection('giftVouchers').doc(id).set(data);
}
console.log(`seeded ${GIFT_VOUCHERS.length} gift vouchers`);

/*
 * REAL APPOINTMENTS for the next few days.
 *
 * ### Why this exists
 * The fixture used to fabricate `barberBusy` and stop there. That fed the
 * client booking grid (which reads the projection) but left `appointments`
 * EMPTY — so `/staff/schedule`, whose lanes read appointment documents,
 * rendered "0 visits" on every chair no matter what the calendar showed. The
 * two surfaces were seeded from different sources and quietly disagreed.
 *
 * Writing the appointment is now the only act: `rebuildBusyOnAppointmentChange`
 * derives `barberBusy` for these days from it, so the projection agrees with
 * the book BY CONSTRUCTION rather than by two hand-written tables matching.
 * The fabricated busy above starts where these stop.
 *
 * ### The document shape mirrors `appointment-document.ts`
 * Hand-written because this is a plain `.mjs` script with no TS import path.
 * It must move when that mapper does — `arrivedAt` and `seats[].barberPref`
 * are both recent additions and both are represented here.
 *
 * ### Every state the schedule draws
 * A settled cut, one in progress (arrived), two still to come, a mixed party
 * across two chairs, a no-show and a cancellation — because a fixture that
 * only produces the happy path proves only the happy path.
 */
const ZONE = SCHEDULING_ZONE;

/** `2026-08-07` for a day offset — the key `busyKeys` and lanes agree on. */
function dayKeyAt(dayOffset) {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + dayOffset);
  const pad = (n) => String(n).padStart(2, '0');
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
  ].join('-');
}

/**
 * The chair's own terms for a service and variant, from the catalogue above
 * — the price a seat is SOLD at. A seat used to be seeded at a flat 28,00 €
 * whatever the service, so every seeded visit read as custom-priced («по
 * договорка») on the staff sheet (owner, 2026-09-10).
 */
function chairTerms(serviceId, barberId, variantId) {
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
  const offering =
    service.offerings.find((entry) => entry.barberId === barberId) ??
    service.offerings[0];
  if (!offering) throw new Error(`seed: nobody offers ${serviceId}`);
  return (variantId && offering.byVariant?.[variantId]) || offering.base;
}

function seatOf({
  id,
  barberId,
  serviceId,
  variantId = null,
  dayOffset,
  hour,
  minute,
  minutes,
  subject,
  pref,
  outcome,
}) {
  const endMinute = minute + minutes;
  const sold = chairTerms(serviceId, barberId, variantId);
  return {
    id,
    serviceId,
    variantId,
    barberId,
    // What the client ASKED for, beside what they got — the flag that tells
    // staff on a sick day which bookings can move chairs without a call.
    barberPref: pref,
    terms: {
      priceMinorUnits: sold.priceMinorUnits,
      currencyCode: 'EUR',
      // The minutes stay the seed's own: a visit booked shorter or longer
      // than the catalogue is what the frame's tag exists to show.
      durationMinutes: minutes,
      setupMinutes: 0,
      cleanupMinutes: 0,
    },
    slot: {
      startIso: isoAt(dayOffset, hour, minute),
      endIso: isoAt(
        dayOffset,
        hour + Math.floor(endMinute / 60),
        endMinute % 60,
      ),
      zone: ZONE,
    },
    subject,
    outcome,
  };
}

const account = (userId) => ({ kind: 'account', userId, relationship: 'self' });
const guest = (label) => ({ kind: 'anonymous', label });
const scheduled = { kind: 'scheduled' };

/**
 * A seeded "finished" visit on TODAY is finished only once its time has
 * passed (owner, 2026-09-09: a 10:00 cut read «Минал» at 09:55). Before
 * that it is an ordinary confirmed booking, so the sheet shows the live
 * states — «след 5 мин», «В момента», «Дошъл» — on real data.
 */
function settledOnlyIfPast(appointment) {
  if (appointment.dayOffset !== 0 || appointment.status.kind !== 'completed')
    return appointment;
  const zoneNow = new Date();
  const ends = appointment.seats.map(
    (seat) => seat.hour * 60 + seat.minute + seat.minutes,
  );
  const nowMinute = zoneNow.getHours() * 60 + zoneNow.getMinutes();
  if (nowMinute >= Math.max(...ends)) return appointment;
  return {
    ...appointment,
    status: { kind: 'confirmed' },
    seats: appointment.seats.map((seat) => ({ ...seat, outcome: scheduled })),
  };
}

const APPOINTMENTS_RAW = [
  {
    id: 'appt-dev-1',
    dayOffset: 0,
    ownerUserId: 'dev-client-1',
    status: { kind: 'completed' },
    contact: {
      name: 'Георги Петров',
      phone: '+359881234567',
      email: 'georgi@test.local',
      note: null,
    },
    seats: [
      {
        id: 'seat-1',
        barberId: 'ivan',
        serviceId: 'svc-fade',
        hour: 10,
        minute: 0,
        minutes: 45,
        subject: account('dev-client-1'),
        pref: 'specific',
        outcome: { kind: 'worked', atMs: Date.now() },
      },
    ],
  },
  {
    id: 'appt-dev-2',
    dayOffset: 0,
    ownerUserId: 'dev-client-2',
    status: { kind: 'confirmed' },
    // Already in the chair: the NOW treatment and the "Done" verb both need
    // an arrival to be reachable at all.
    arrived: true,
    contact: {
      name: 'Мартин Илиев',
      phone: '+359887654321',
      email: 'martin@test.local',
      note: 'Къса отстрани',
    },
    seats: [
      {
        id: 'seat-2',
        barberId: 'ivan',
        serviceId: 'svc-classic-cut',
        variantId: 'short',
        hour: 12,
        minute: 30,
        minutes: 30,
        subject: account('dev-client-2'),
        pref: 'any',
        outcome: scheduled,
      },
    ],
  },
  {
    id: 'appt-dev-3',
    dayOffset: 0,
    ownerUserId: 'dev-client-3',
    status: { kind: 'confirmed' },
    contact: {
      name: 'Петър Димитров',
      phone: '+359882223344',
      email: 'petar@test.local',
      note: null,
    },
    seats: [
      {
        id: 'seat-3',
        barberId: 'niko',
        serviceId: 'svc-beard',
        hour: 14,
        minute: 0,
        minutes: 30,
        subject: account('dev-client-3'),
        pref: 'specific',
        outcome: scheduled,
      },
    ],
  },
  {
    // A MIXED PARTY across two chairs — one appointment, two seats, two
    // lanes. The cross-lane tie and the per-seat resolution both need it.
    id: 'appt-dev-4',
    dayOffset: 0,
    ownerUserId: 'dev-client-4',
    status: { kind: 'confirmed' },
    contact: {
      name: 'Стоян Колев',
      phone: '+359881112233',
      email: null,
      note: null,
    },
    seats: [
      {
        id: 'seat-4a',
        barberId: 'ivan',
        serviceId: 'svc-fade',
        hour: 16,
        minute: 0,
        minutes: 45,
        subject: account('dev-client-4'),
        pref: 'specific',
        outcome: scheduled,
      },
      {
        id: 'seat-4b',
        barberId: 'stefan',
        serviceId: 'svc-classic-cut',
        variantId: 'long',
        hour: 16,
        minute: 0,
        minutes: 30,
        subject: guest('Синът на Стоян'),
        pref: 'any',
        outcome: scheduled,
      },
    ],
  },
  {
    id: 'appt-dev-5',
    dayOffset: 0,
    ownerUserId: 'dev-client-5',
    status: { kind: 'no_show' },
    contact: {
      name: 'Кирил Тодоров',
      phone: '+359884445566',
      email: 'kiril@test.local',
      note: null,
    },
    seats: [
      {
        id: 'seat-5',
        barberId: 'stefan',
        serviceId: 'svc-beard',
        hour: 11,
        minute: 0,
        minutes: 30,
        subject: account('dev-client-5'),
        pref: 'specific',
        outcome: { kind: 'no_show', atMs: Date.now() },
      },
    ],
  },
  {
    id: 'appt-dev-6',
    dayOffset: 1,
    ownerUserId: 'dev-client-6',
    status: { kind: 'cancelled', reason: 'client_changed_plans' },
    contact: {
      name: 'Николай Иванов',
      phone: '+359883334455',
      email: null,
      note: null,
    },
    seats: [
      {
        id: 'seat-6',
        barberId: 'ivan',
        serviceId: 'svc-fade',
        hour: 10,
        minute: 0,
        minutes: 45,
        subject: account('dev-client-6'),
        pref: 'any',
        outcome: {
          kind: 'cancelled',
          atMs: Date.now(),
          by: 'client',
          reason: { kind: 'client_changed_plans' },
        },
      },
    ],
  },
  {
    id: 'appt-dev-7',
    dayOffset: 1,
    ownerUserId: 'dev-client-7',
    status: { kind: 'confirmed' },
    contact: {
      name: 'Александър Стоянов',
      phone: '+359887778899',
      email: null,
      note: null,
    },
    seats: [
      {
        id: 'seat-7',
        barberId: 'niko',
        serviceId: 'svc-modern-cut',
        hour: 15,
        minute: 0,
        minutes: 45,
        subject: account('dev-client-7'),
        pref: 'specific',
        outcome: scheduled,
      },
    ],
  },
  {
    id: 'appt-dev-8',
    dayOffset: 2,
    ownerUserId: 'dev-client-8',
    status: { kind: 'confirmed' },
    contact: {
      name: 'Емил Георгиев',
      phone: '+359886665544',
      email: 'emil@test.local',
      note: null,
    },
    seats: [
      {
        id: 'seat-8',
        barberId: 'stefan',
        serviceId: 'svc-scissor-trim',
        variantId: 'long',
        hour: 13,
        minute: 0,
        minutes: 30,
        subject: account('dev-client-8'),
        pref: 'any',
        outcome: scheduled,
      },
    ],
  },
];
const APPOINTMENTS = APPOINTMENTS_RAW.map(settledOnlyIfPast);

for (const appointment of APPOINTMENTS) {
  const seats = appointment.seats.map((seat) =>
    seatOf({ ...seat, dayOffset: appointment.dayOffset }),
  );
  const starts = seats.map((seat) => seat.slot.startIso).sort();
  const ends = seats.map((seat) => seat.slot.endIso).sort();
  const dayKey = dayKeyAt(appointment.dayOffset);

  await db
    .collection('appointments')
    .doc(appointment.id)
    .set({
      locationId: 'loc-center',
      ownerUserId: appointment.ownerUserId,
      barberIds: [...new Set(seats.map((seat) => seat.barberId))].sort(),
      // The rebuild trigger's reverse index — one key per (barber, day) this
      // appointment occupies. `array-contains` on it is how one cancelled
      // booking recomputes exactly the busy docs it touched.
      busyKeys: [
        ...new Set(seats.map((seat) => `${seat.barberId}__${dayKey}`)),
      ].sort(),
      timeSlot: {
        startIso: starts[0],
        endIso: ends[ends.length - 1],
        zone: ZONE,
      },
      seats,
      status: appointment.status,
      // Booked a week out, so lead-time figures have something real to read.
      bookedAt: { iso: isoAt(appointment.dayOffset - 7, 12, 0), zone: ZONE },
      bookedFromAppointmentId: null,
      arrivedAt: appointment.arrived
        ? { iso: isoAt(appointment.dayOffset, 12, 25), zone: ZONE }
        : null,
      contact: appointment.contact,
    });
}
console.log(
  `seeded ${APPOINTMENTS.length} appointments across ${APPOINTMENT_DAYS} days` +
    ' (barberBusy for those days is rebuilt from them by the trigger)',
);

console.log(
  `Done: ${SERVICES.length} services + ${BARBERS.length} barbers + ${LOCATIONS.length} locations + ${SCHEDULES.length} rosters + 1 category + booking policy in the ${PROJECT_ID} emulators.`,
);
process.exit(0);
