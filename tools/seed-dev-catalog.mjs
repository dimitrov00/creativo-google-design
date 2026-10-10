/**
 * Seeds the Firebase EMULATORS with a small barbershop catalog so the
 * onboarding services grid (and anything else reading `CatalogReader`) has
 * real data to render in dev: one category, six single services and two
 * bundles with cover art uploaded to the Storage emulator from
 * `apps/web/public/work/`, plus the two shop `locations` the booking flow
 * schedules against — and a CLIENT BOOK: eighteen months of past visits,
 * one named fixture per client-details state, and the `clientStats` the
 * production projection computes from them.
 *
 * The haircut family carries REAL `conflictsWith` data (a seat cannot hold
 * two haircuts) — `svc-finish` is deliberately left one-way so the booking
 * flow's symmetric conflict normalization is exercised against seeded data
 * rather than only in unit tests.
 *
 * ### What lives where
 * `tools/seed/` holds the data and the pure generators — the catalogue
 * (`catalog.mjs`), the shop calendar (`calendar.mjs`), the clients and their
 * fixtures (`fixtures.mjs`, which names each state), the history generator
 * (`history.mjs`), the document builder (`appointments.mjs`), the loyalty
 * engine's output (`loyalty.mjs`) and the promotions (`promotions.mjs`).
 * This file only writes. `seed-tools`' specs check every document against
 * the real mapper and every fixture against the real `computeClientStats`.
 *
 * ### Requirements beyond the emulators
 * The seed runs production TypeScript in-process: at start it bundles the
 * functions' `recomputeClientStats` (and the mapper it reads with) using the
 * workspace's own `esbuild`, into `node_modules/.cache/creativo-seed/`, and
 * imports it (`tools/seed/load-domain.mjs`, about half a second). So the
 * workspace's dependencies must be installed (`pnpm install`); nothing needs
 * building first. Every fixture is parsed by the real `appointmentFromDocument`
 * before the first write, so a document the trigger could not read stops the
 * seed instead of half-seeding the emulator. The client card's documents —
 * the loyalty catalogue, each loyalty account, Мартин's waitlist request —
 * are read back through the card's own readers from the same bundle just
 * before each is written (`readLoyaltyWrites`, `waitlistFromDocument`), so
 * one the card could not read is never written; the coupons and the gift
 * vouchers likewise (`readPromotionWrites`). The catalogue mode has no
 * bundle and writes its catalogue unread: `loyalty.spec.mjs` reads that
 * catalogue back on every day it tries.
 *
 * Emulator-only by construction: refuses to run unless
 * FIRESTORE_EMULATOR_HOST is set, so it can never touch a real project.
 * Idempotent — fixed doc ids, `set()` overwrites, every instant derived from
 * the shop's calendar rather than the clock, and the stats written only when
 * their state-based answer changed. A second run on the same day writes the
 * same documents.
 *
 * Run with the dev stack up (`pnpm run dev`):
 *   pnpm run seed:dev
 *
 * ### `--catalog-only`
 *   node tools/seed-dev-catalog.mjs --catalog-only
 * Writes the catalogue and stops after the booking policy: category,
 * locations, rosters, the busy days and the published exceptions, barbers
 * (their faces included), services. No staff account, client book, client
 * avatars, promotions or stats — and no TypeScript bundle, which only the
 * book needs. The e2e suite's global setup runs it: each spec seeds the
 * people and visits it asserts on, and the client book's five hundred
 * trigger runs would only load the emulators under the suite. The book's
 * shop calendar is still built, because the busy fabrication starts where
 * its appointment days end — so in this mode those first days carry no
 * busy at all. Nothing is deleted: a book an earlier full run wrote stays.
 * The loyalty catalogue is catalogue too, and is written in this mode; the
 * loyalty accounts are the book's, and are not.
 *
 * ### `--check`
 *   node tools/seed-dev-catalog.mjs --check
 * Writes nothing: reads the emulator's loyalty catalogue and compares every
 * document with `catalog.json` (`loyaltyCatalogDriftOf` — each family's
 * `emblem` and every other field, a season's window excepted, which is the
 * seed day's). Exits 1, naming each document that differs, when the
 * emulator was seeded before `catalog.json` last changed. A capture runs it
 * first and refuses to shoot over a stale catalogue: wave D r3 rendered the
 * families' old faces that way. Re-seed with `--catalog-only` (or
 * `pnpm run seed:dev`), then check again.
 *
 * ### Loyalty (client-card-redesign.md §4.6, client-card-revision-3.md §4)
 * The loyalty catalogue is `catalog.json` from ecs-core's test fixtures
 * (`libs/ecs-core/src/testing/fixtures/loyalty/`), its
 * seasons moved to the shop's today. The accounts of Георги and Мартин —
 * account, family and season progress, the journal — are the engine's
 * output over the same appointments (`tools/seed/loyalty.mjs`), never typed
 * in; beside them, for the client card: the coupons the engine granted
 * them (the stamp card's held one among them), Георги's gift voucher, three
 * photos of his last cuts, and Мартин's open waitlist request.
 *
 * ### The rhythm's rule is the SHOP's once it has published one
 * `streakDefinitions/cadence` is a head (the version in force, the one that
 * waits) over a history of immutable versions. The seed writes the FIRST
 * version, head and history. Every later one is published for real, by the
 * admin, from `/admin/loyalty/rhythm`: from then on the seed writes neither
 * (`rulesPublishedOver`), in either mode, and projects the accounts under
 * the rule the emulator holds. So: publish another interval, run
 * `pnpm run seed:dev` again, and Георги's and Мартин's cards move. To go
 * back to the seed's rule, restart the emulators (their data is in memory).
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import admin from 'firebase-admin';
import {
  BARBERS,
  CATEGORY,
  LOCATIONS,
  SCHEDULES,
  SERVICES,
  scheduleExceptionsFor,
} from './seed/catalog.mjs';
import { CANCELLATION_WINDOW_HOURS } from './seed/appointments.mjs';
import { buildClientBook, searchFields } from './seed/fixtures.mjs';
import { loadSeedDomain } from './seed/load-domain.mjs';
import {
  BADGE_PROGRESS_COLLECTION,
  CLIENT_JOURNAL_COLLECTION,
  LOYALTY_ACCOUNTS_COLLECTION,
  LOYALTY_CATALOG_TODAY,
  LOYALTY_HOLDERS,
  SEASON_PROGRESS_COLLECTION,
  catalogAsHeld,
  loyaltyCatalogDriftOf,
  loyaltyCatalogFor,
  loyaltyCatalogWritesOf,
  loyaltyWritesOf,
  projectLoyaltyFor,
  readLoyaltyWrites,
  rulesPublishedOver,
  withoutPublishedRules,
  workedVisitsOf,
} from './seed/loyalty.mjs';
import {
  COUPON_GRANTS_COLLECTION,
  couponGrantWritesOf,
  couponWritesOf,
  giftVoucherWritesOf,
  readPromotionWrites,
} from './seed/promotions.mjs';
import { waitlistRequestWriteOf } from './seed/waitlist.mjs';

/** The catalogue alone — see `--catalog-only` above. */
const CATALOG_ONLY = process.argv.includes('--catalog-only');
/** Compare, never write — see `--check` above. */
const CHECK_ONLY = process.argv.includes('--check');

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

/**
 * A download token for an object the rules keep private — UUID-shaped, as
 * Storage mints them, but derived from the path, so every run writes the
 * same one and a stored URL stays good across reseeds.
 */
function downloadTokenFor(path) {
  const hex = createHash('sha256').update(`seed:${path}`).digest('hex');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `4${hex.slice(13, 16)}`,
    `a${hex.slice(17, 20)}`,
    hex.slice(20, 32),
  ].join('-');
}

/** Stops the seed before it writes a loyalty document the client card could not read. */
function refuseUnreadable({ problems }) {
  if (problems.length > 0) {
    throw new Error(
      `seed: the client card could not read\n  ${problems.join('\n  ')}`,
    );
  }
}

/** What the emulator holds at each of `writes`' paths: the document, or `undefined` for none. */
async function storedAt(writes) {
  const snapshots = await db.getAll(...writes.map(({ path }) => db.doc(path)));
  return new Map(
    snapshots.map((snapshot) => [
      snapshot.ref.path,
      snapshot.exists ? snapshot.data() : undefined,
    ]),
  );
}

/*
 * `--check`: the emulator's loyalty catalogue against `catalog.json` as it
 * stands (the fixtures' own day, so no season moves — the drift skips the
 * windows anyway), read-only, before anything below could write.
 */
if (CHECK_ONLY) {
  const writes = loyaltyCatalogWritesOf(
    loyaltyCatalogFor(LOYALTY_CATALOG_TODAY),
  );
  // A rule the shop has published is not drift: the seed would not write it.
  const stored = await storedAt(writes);
  const drift = loyaltyCatalogDriftOf(writes, stored);
  const published = rulesPublishedOver(writes, stored);
  const compared = withoutPublishedRules(writes, published).length;
  if (drift.length > 0) {
    console.error(
      `seed --check: the emulator's loyalty catalogue is not catalog.json's (${drift.length} of ${compared} documents differ):\n  ${drift.join('\n  ')}\nRe-seed it (node tools/seed-dev-catalog.mjs --catalog-only, or pnpm run seed:dev) before capturing.`,
    );
    process.exit(1);
  }
  console.log(
    `seed --check: the loyalty catalogue is catalog.json's (${compared} documents)` +
      published
        .map((streakId) => `; the ${streakId} rhythm is the shop's own`)
        .join(''),
  );
  process.exit(0);
}

/*
 * Everything that can refuse does so BEFORE the first write: the TypeScript
 * bundle, and every appointment the book is about to hold, read back through
 * the real mapper exactly as the stats trigger will read it.
 */
const domain = CATALOG_ONLY ? null : await loadSeedDomain();
// Built in both modes: its calendar and its appointment days place the busy.
const clientBook = buildClientBook(Date.now());
const { calendar } = clientBook;
if (!CATALOG_ONLY) {
  for (const { id, doc } of clientBook.appointments) {
    const parsed = domain.appointmentFromDocument(id, doc);
    if (parsed.isFailure()) {
      console.error(`seed: ${id} does not parse: ${parsed.error.message}`);
      process.exit(1);
    }
  }
}

await db
  .collection('serviceCategories')
  .doc(CATEGORY.id)
  .set({ name: CATEGORY.name, sortOrder: CATEGORY.sortOrder });

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
    shortName: location.shortName,
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
 *
 * Days and times come from the shop's calendar (`tools/seed/calendar.mjs`):
 * wall-clock ISO strings carrying the offset Sofia has THAT day — the shape
 * `commitBooking` writes — keyed by Sofia's date whatever the machine's zone.
 */
const SCHEDULING_ZONE = calendar.zone;

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
 * How many days from today are seeded with REAL appointments — three by
 * intent, four when a day fixture had to move past a closed day to find its
 * barber at work (`placeDayFixture`).
 *
 * Those days get their `barberBusy` from the `rebuildBusyOnAppointmentChange`
 * trigger instead of the fabrication below, so the two surfaces cannot
 * disagree — see the appointments block near the end of this file.
 */
const APPOINTMENT_DAYS = clientBook.appointmentDays;

for (const schedule of SCHEDULES) {
  // eslint-disable-next-line security/detect-object-injection -- fixed keys.
  const pattern = BUSY_PATTERN[schedule.barberId] ?? [];
  for (let offset = APPOINTMENT_DAYS; offset < BUSY_HORIZON_DAYS; offset++) {
    const dayKey = calendar.dayKeyAt(offset);

    // Vary the load so the calendar's per-day markers are not uniform — a
    // grid where every day looks identical proves nothing.
    const density = (offset * 7 + schedule.barberId.length) % 3;
    const busy = pattern
      .slice(0, density === 0 ? pattern.length : density)
      .map(([fromH, fromM, toH, toM]) => ({
        startIso: calendar.isoAt(offset, fromH, fromM),
        endIso: calendar.isoAt(offset, toH, toM),
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
      (CATALOG_ONLY
        ? ' (earlier days stay free: no appointments in this mode)'
        : ' (earlier days come from real appointments)'),
  );
}

/*
 * The published schedule exceptions (`scheduleExceptionsFor`: Stefan off on
 * the first day from five days out that his roster works), the same answer
 * the day fixtures are placed around.
 *
 * The SANITIZED public doc — effect only, structurally no reason field (the
 * domain's `sick`/`training` reasons are staff-only data and must never be
 * derivable from the anonymous surface). Seeded so the calendar visibly
 * greys a day the roster says is worked; if it stops greying, the exception
 * pipeline broke.
 */
for (const exception of scheduleExceptionsFor(calendar)) {
  const dayKey = calendar.dayKeyAt(exception.dayOffset);
  const id = `${exception.barberId}__${dayKey}`;
  await db.collection('scheduleExceptions').doc(id).set({
    barberId: exception.barberId,
    dayKey,
    zone: SCHEDULING_ZONE,
    locationId: exception.locationId,
    effect: exception.effect,
  });
  console.log(`seeded scheduleExceptions/${id} (${exception.effect.kind})`);
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

/*
 * ONE PHOTO, ONE OBJECT (wave D r6): the two bundles wear their first
 * member's photo — the SAME picture from the shop's library, not a second
 * copy under their own id — so every surface resolves it to one URL, and
 * the client card can tell one picture on two families from two pictures
 * (§3.3.3: the picture is the first family's, «Пълна грижа» and «Баща и
 * син» draw their letters). The booking pages still show it on both.
 */
const coverOfFile = new Map();
for (const service of SERVICES) {
  const cover =
    coverOfFile.get(service.file) ??
    (await uploadCover(service.file, service.id));
  coverOfFile.set(service.file, cover);
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
  // The window the seeded cancellations are stamped with — one number.
  cancellationWindowHours: CANCELLATION_WINDOW_HOURS,
  maxFlexibleDays: 7,
});
console.log('seeded settings/bookingPolicy');

/*
 * THE LOYALTY CATALOGUE (client-card-redesign.md §4.6): the achievement
 * shelves and their medal families, the seasons and the event, the tiers,
 * the rewards and the rhythm — `catalog.json` from ecs-core's test fixtures
 * (`libs/ecs-core/src/testing/fixtures/loyalty/`),
 * the same file the mapper specs and the e2e read, with its seasons moved to
 * the shop's today so every run has one open season, one open event and one
 * ended season. Presentation, not personal data: anyone signed in reads it,
 * so the catalogue mode writes it too.
 *
 * THE RHYTHM'S RULE goes in with it: the head, and the first version under
 * it. Unless the shop has published a rule of its own since (see the head
 * of this file): then neither is written, and `loyaltyCatalog` — what the
 * accounts below are projected under — holds the emulator's rule.
 */
const loyaltyToday = calendar.dayKeyAt(0);
const seededCatalog = loyaltyCatalogFor(loyaltyToday);
const seededCatalogWrites = loyaltyCatalogWritesOf(seededCatalog);
const storedCatalog = await storedAt(seededCatalogWrites);
const publishedRules = rulesPublishedOver(seededCatalogWrites, storedCatalog);
const loyaltyCatalog = catalogAsHeld(
  seededCatalog,
  publishedRules,
  storedCatalog,
);
{
  const writes = withoutPublishedRules(seededCatalogWrites, publishedRules);
  // Only the full run holds the readers (see "Requirements" above). The
  // catalogue is read as the emulator will hold it: a rule the shop
  // published is read beside what is written, and is not written.
  if (domain) {
    const kept = publishedRules.map((streakId) => ({
      path: `streakDefinitions/${streakId}`,
      data: loyaltyCatalog.streakDefinitions[streakId],
    }));
    refuseUnreadable(readLoyaltyWrites(domain, [...writes, ...kept]));
  }
  const batch = db.batch();
  for (const { path, data } of writes) batch.set(db.doc(path), data);
  await batch.commit();
  console.log(
    `seeded the loyalty catalogue: ${writes.length} documents, seasons as of ${loyaltyToday}`,
  );
  for (const streakId of publishedRules) {
    const { current, scheduled } = loyaltyCatalog.streakDefinitions[streakId];
    console.log(
      `kept the ${streakId} rhythm as the shop published it: version ${current.version} since ${current.effectiveFrom}` +
        (scheduled
          ? `, version ${scheduled.version} from ${scheduled.effectiveFrom}`
          : ''),
    );
  }
}

if (CATALOG_ONLY) {
  console.log(
    'catalogue only: no staff account, client book, avatars, promotions, stats or loyalty accounts',
  );
  process.exit(0);
}

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
// `searchFields` is `tools/seed/fixtures.mjs`'s: one copy of the prefix rule.
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
 * Names and numbers are the same ones their seeded bookings carry, and
 * EVERY account on a seat has one: `dev-client-5/6/8` owned bookings for
 * months with no profile behind them, which no client page can render.
 * Мартин's `birthDate` is today's month and day — the birthday state.
 */
{
  const batch = db.batch();
  for (const { uid, doc } of clientBook.users) {
    batch.set(db.doc(`users/${uid}`), doc);
  }
  await batch.commit();
}
console.log(`seeded ${clientBook.users.length} client profiles`);

/*
 * CLIENT PORTRAITS — none until the seed has a client's own photo
 * (wave D r6). A client's portrait lives in Storage under their id — the
 * profile's own convention, `avatars/{uid}/original` — and from 2026-09-18
 * the two account holders wore the BARBERS' portraits: Мартин was Нико's
 * photo beside his own «С Нико» medal, Георги Петров «Стефан Петров»'s,
 * and a client drawn as a barber is not data (the card draws the barbers'
 * faces as medal art beside the head). The seed's media hold no client's
 * photograph, so each holder shows initials, and a portrait an earlier run
 * uploaded is removed. A client's own photo at
 * `apps/web/public/clients/{uid}.jpg` — never a file from `barbersDir` —
 * is uploaded instead; it also completes that profile's «Пълен профил».
 */
{
  const clientsDir = join(publicDir, 'clients');
  let faces = 0;
  for (const uid of ['dev-client-1', 'dev-client-2']) {
    const object = bucket.file(`avatars/${uid}/original`);
    const own = join(clientsDir, `${uid}.jpg`);
    if (existsSync(own)) {
      await object.save(readFileSync(own), { contentType: 'image/jpeg' });
      faces += 1;
    } else {
      await object.delete({ ignoreNotFound: true });
    }
  }
  console.log(`seeded ${faces} client portraits (the rest show initials)`);
}

/*
 * PROMOTIONS (2026-09-10): what the visit sheet's «Отстъпка» row can offer,
 * and what the client card shows as held — the coupons, the grants, the
 * gift vouchers of `tools/seed/promotions.mjs`. `coupon-birthday` carries
 * its occasion (client-card-revision-3.md §4.6), Георги holds a voucher
 * (§4.5), and the coupons the loyalty engine granted the two account
 * holders are here under the ids their journal rows name.
 *
 * Read back before anything is written: a coupon through the adapters' own
 * mapper, a voucher through its reader, a grant against the coupon it
 * points at. A holder's grant the seed once wrote and no longer does goes
 * in the same batch; nobody else's grant is touched.
 */
{
  const coupons = couponWritesOf();
  const grants = couponGrantWritesOf(clientBook, loyaltyCatalog, loyaltyToday);
  const vouchers = giftVoucherWritesOf(calendar);
  const writes = [...coupons, ...grants, ...vouchers];
  refuseUnreadable(readPromotionWrites(domain, writes));
  const keep = new Set(writes.map(({ path }) => path));
  const batch = db.batch();
  for (const holder of LOYALTY_HOLDERS) {
    const held = await db
      .collection(COUPON_GRANTS_COLLECTION)
      .where('userId', '==', holder.uid)
      .get();
    for (const { ref } of held.docs) {
      const seeded =
        ref.id.startsWith(holder.stampGrants.id) ||
        holder.redemptions.some(({ id }) => ref.id === `grant-${id}`);
      if (seeded && !keep.has(ref.path)) batch.delete(ref);
    }
  }
  for (const { path, data } of writes) batch.set(db.doc(path), data);
  await batch.commit();
  console.log(
    `seeded ${coupons.length} coupons, ${grants.length} grants and ${vouchers.length} gift vouchers`,
  );
}

/*
 * REAL APPOINTMENTS — eighteen months back and three or four days ahead
 * (`APPOINTMENT_DAYS`), each inside its barber's bookable window.
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
 * ### The past (design §12.4 P0 «Seed»)
 * With no visit before today, every client-details state — a regular, a
 * pause suggestion, a late cancel, a companion's history — was untestable in
 * preview. `tools/seed/fixtures.mjs` names one fixture per state and
 * `tools/seed/history.mjs` generates the months behind them: real shifts,
 * catalogue prices in EUR, tips, both placements and the rebooking edge.
 *
 * ### The document shape IS `appointment-document.ts`'s
 * Built by `tools/seed/appointments.mjs`, parsed back through the real
 * `appointmentFromDocument` above before anything was written, and
 * round-tripped through `appointmentToDocument` in `seed-tools`' spec — the
 * `subjectUserIds` and `placement` mirrors (R33) included.
 */
const WRITE_BATCH = 200;
for (let i = 0; i < clientBook.appointments.length; i += WRITE_BATCH) {
  const batch = db.batch();
  for (const { id, doc } of clientBook.appointments.slice(i, i + WRITE_BATCH)) {
    batch.set(db.collection('appointments').doc(id), doc);
  }
  await batch.commit();
}
{
  const days = clientBook.appointments
    .map(({ doc }) => doc.timeSlot.startIso.slice(0, 10))
    .sort();
  console.log(
    `seeded ${clientBook.appointments.length} appointments, ${days[0]}..${days[days.length - 1]}` +
      ' (barberBusy for those days is rebuilt from them by the trigger)',
  );
}

/*
 * CLIENT STATS, as the trigger computes them — because it IS the trigger's
 * code (design §12.5.7, "the seed is engine output"): `recomputeClientStats`
 * from `apps/functions/src/lib/clients/`, bundled at start and run here
 * in-process for every account on a seat. State-based under a revision
 * guard, so it writes only what differs from what is stored.
 *
 * With the functions emulator up, `dispatchClientProjections` is recomputing
 * the same clients from the writes above at the same time. Both land on the
 * same answer; a transaction that loses the race to the other is retried.
 * Without it (`firestore,auth` only), this is the only writer — and the
 * reason stats exist at all in that setup.
 */
const statsPolicy = await domain.loadClientStatsPolicy(db);

async function recomputeStats(userId) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await domain.recomputeClientStats(db, userId, {
        policy: statsPolicy,
        clockMs: Date.now,
      });
    } catch (error) {
      if (attempt >= 4) throw error;
      await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt));
    }
  }
}

const statsTally = { written: 0, unchanged: 0, skipped: 0 };
for (const userId of clientBook.subjects) {
  statsTally[await recomputeStats(userId)] += 1;
}
console.log(
  `seeded clientStats + restricted/money for ${clientBook.subjects.length} clients` +
    ` (${statsTally.written} written, ${statsTally.unchanged} already current)`,
);

/*
 * LOYALTY ACCOUNTS (client-card-redesign.md §4.6), as the engine would hold
 * them: Георги's and Мартин's account, family progress, season progress and
 * point rows, derived from the appointments above by `projectLoyaltyFor` —
 * so «Посещения» is `clientStats`' completed visits and the balance is the
 * sum of the rows, by construction. What no appointment says comes from the
 * profile (the e-mail, the birthday, the portrait when Storage holds one) and from
 * `LOYALTY_HOLDERS` (the rewards they bought at the desk).
 *
 * THE RHYTHM is the domain's own projection (client-card-revision-3.md
 * §4.2): the fold hands each holder's visits, called-off visits and
 * bookings to `traceStreak` from the bundle, under the rule in force today
 * — the seed's first version, or whatever the shop has published since.
 *
 * THE JOURNAL holds every kind of row «Движение» shows (§4.7): the points,
 * and a row for each level earned, each change of tier, each coupon the
 * stamp card minted and each reward bought.
 *
 * A holder's documents are REPLACED, not merged: a family, a season or a row
 * an earlier run wrote and today's projection does not hold is deleted in
 * the same batch, so the balance always sums the rows that are there.
 */
for (const holder of LOYALTY_HOLDERS) {
  const { uid } = holder;
  const user = clientBook.users.find((entry) => entry.uid === uid);
  if (!user) throw new Error(`seed: loyalty holder ${uid} has no profile`);
  const [hasAvatar] = await bucket.file(`avatars/${uid}/original`).exists();
  const projection = projectLoyaltyFor(
    domain,
    uid,
    clientBook.appointments,
    loyaltyCatalog,
    loyaltyToday,
    {
      profile: {
        email: user.doc.email,
        birthDate: user.doc.birthDate,
        hasAvatar,
      },
      redemptions: holder.redemptions,
      stampGrants: holder.stampGrants,
    },
  );
  const writes = projection === null ? [] : loyaltyWritesOf(uid, projection);
  refuseUnreadable(readLoyaltyWrites(domain, writes));
  const keep = new Set(writes.map(({ path }) => path));
  const account = db.collection(LOYALTY_ACCOUNTS_COLLECTION).doc(uid);
  const earlier = [
    account,
    ...(await account.collection(BADGE_PROGRESS_COLLECTION).listDocuments()),
    ...(await account.collection(SEASON_PROGRESS_COLLECTION).listDocuments()),
    ...(
      await db
        .collection(CLIENT_JOURNAL_COLLECTION)
        .where('userId', '==', uid)
        .get()
    ).docs.map((doc) => doc.ref),
  ];
  const batch = db.batch();
  for (const ref of earlier) if (!keep.has(ref.path)) batch.delete(ref);
  for (const { path, data } of writes) batch.set(db.doc(path), data);
  await batch.commit();
  if (projection === null) {
    console.log(`seeded no loyalty account for ${uid}: nothing to fold`);
    continue;
  }
  const levels = Object.values(projection.badgeProgress).reduce(
    (sum, progress) => sum + progress.earned.length,
    0,
  );
  const rhythm = projection.account.streaks.cadence;
  console.log(
    `seeded loyalty for ${uid}: ${projection.account.balance} points, ` +
      `${projection.account.tier.current}, ${levels} levels, ${projection.account.seq} journal rows, ` +
      (rhythm
        ? `${rhythm.current} in rhythm under version ${rhythm.definitionVersion} (${rhythm.phase.kind})`
        : 'no rhythm (the rule is off)'),
  );
}

/*
 * PAST CUTS (§4.6): a photo of each of Георги's last three worked visits,
 * as the visit sheet's shutter writes one (`FirebaseAppointmentPhotos.
 * attach`): the object at `appointmentPhotos/{appointmentId}/{photoId}`
 * with the facts as its metadata, the document beside it with every field
 * `toPhoto` reads. `appointmentPhotos/**` is staff-only in Storage, so the
 * stored `url` carries a download token — derived from the path, like every
 * id here, so a second run writes the same bytes. When a slot moves to a
 * newer visit, the object it held goes with it.
 */
{
  const uid = 'dev-client-1';
  const user = clientBook.users.find((entry) => entry.uid === uid);
  const clientLabel = `${user.doc.firstName} ${user.doc.lastName}`;
  // Every picture under apps/web/public/work is 1100 × 1400.
  const files = ['fade-styling.jpg', 'classic-clippers.jpg', 'modern-cut.jpg'];
  const recent = workedVisitsOf(uid, clientBook.appointments)
    .filter((visit) => visit.day <= loyaltyToday)
    .slice(-files.length)
    .reverse();
  for (const [index, visit] of recent.entries()) {
    const photoId = `photo-dev-georgi-${index + 1}`;
    const path = `appointmentPhotos/${visit.appointmentId}/${photoId}`;
    const token = downloadTokenFor(path);
    const takenAtIso = new Date(visit.doneMs).toISOString();
    const [barberId] = visit.barberIds;
    const ref = db.collection('appointmentPhotos').doc(photoId);
    const before = await ref.get();
    if (before.exists && before.get('path') !== path) {
      await bucket.file(before.get('path')).delete({ ignoreNotFound: true });
    }
    await bucket.file(path).save(readFileSync(join(workDir, files.at(index))), {
      contentType: 'image/jpeg',
      metadata: {
        metadata: {
          firebaseStorageDownloadTokens: token,
          appointmentId: visit.appointmentId,
          barberId,
          clientUserId: uid,
          clientLabel,
          takenByUid: STAFF_UID,
          takenAtIso,
        },
      },
    });
    await ref.set({
      photoId,
      appointmentId: visit.appointmentId,
      barberId,
      clientUserId: uid,
      clientLabel,
      takenByUid: STAFF_UID,
      takenAtIso,
      path,
      url:
        `http://${process.env.FIREBASE_STORAGE_EMULATOR_HOST}/v0/b/${BUCKET}` +
        `/o/${encodeURIComponent(path)}?alt=media&token=${token}`,
      width: 1100,
      height: 1400,
      origin: 'shot',
      label: null,
    });
  }
  console.log(`seeded ${recent.length} photos of ${uid}'s last visits`);
}

/*
 * МАРТИН IS WAITING (§4.6; the card's waitlist row): an open request for
 * Thursday and Friday afternoons next week, made last night after every
 * booking of his (`tools/seed/waitlist.mjs`), read back by the production
 * `waitlistFromDocument` before it is written.
 */
{
  const { path, data } = waitlistRequestWriteOf(clientBook);
  if (domain.waitlistFromDocument(data.id, data) === null) {
    throw new Error(`seed: the client card could not read ${path}`);
  }
  await db.doc(path).set(data);
  console.log(`seeded ${path} (${data.dayKeys.join(', ')}, afternoons)`);
}

console.log(
  `Done: ${SERVICES.length} services + ${BARBERS.length} barbers + ${LOCATIONS.length} locations + ${SCHEDULES.length} rosters + 1 category + booking policy` +
    ` + ${clientBook.users.length} clients with ${clientBook.appointments.length} appointments in the ${PROJECT_ID} emulators.`,
);
process.exit(0);
