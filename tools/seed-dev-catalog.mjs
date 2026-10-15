/**
 * Seeds the Firebase EMULATORS with a small barbershop catalog so the
 * onboarding services grid (and anything else reading the catalogue) has
 * real data to render in dev: one category, six single services and two
 * bundles with cover art uploaded to the Storage emulator from
 * `apps/web/public/work/`, plus the two shop `locations` the booking flow
 * schedules against — and a CLIENT BOOK: eighteen months of past visits,
 * one named fixture per client-details state, each client's record
 * (`customers`, D29) and the `clientStats` the production projection
 * computes from them.
 *
 * The haircut family carries REAL `conflictsWith` data (a seat cannot hold
 * two haircuts) — `svc-finish` is deliberately left one-way so the booking
 * flow's symmetric conflict normalization is exercised against seeded data
 * rather than only in unit tests.
 *
 * ### What lives where
 * Every document this file writes is a FLAT ARCHETYPE BODY (Laws 5–7,
 * flip 1 of the ECS migration): `tools/seed/fixtures/*.fixtures.ts` builds
 * each one and holds it to its `@core/entities` type with
 * `satisfies Omit<X, 'id'>`, so a stale shape fails
 * `pnpm nx typecheck seed-tools` before it could fail a query. Beside them,
 * `tools/seed/` holds the plan logic — the catalogue's hours and terms
 * (`catalog.mjs`), the shop calendar (`calendar.mjs`), the clients and
 * their fixtures (`fixtures.mjs`, which names each state), the history
 * generator (`history.mjs`), the appointment plans (`appointments.mjs`), the
 * loyalty engine's output (`loyalty.mjs`), the promotions (`promotions.mjs`)
 * and Мартин's waitlist request (`waitlist.mjs`). This file only writes.
 *
 * ### Requirements beyond the emulators
 * The seed runs TypeScript in-process: at start it bundles the fixtures,
 * the plan modules and the server's own code it writes through — the
 * `projectClientStats` pipeline, the `firestoreCommitPlan` it commits by,
 * the policy read and `purgeAtFor`, the one TTL stamp — with the
 * workspace's own `esbuild`, into `node_modules/.cache/creativo-seed/`, and
 * imports it (`tools/seed/load-domain.mjs`, well under a second). So the
 * workspace's dependencies must be installed (`pnpm install`); nothing
 * needs building first. Every body is built before the first write, and a
 * builder refuses (throws) what its archetype cannot hold — a seat sold
 * past midnight, a wall-clock start in a DST gap, a contact the booking
 * flow would not take — so a document the app could not read stops the
 * seed instead of half-seeding the emulator. The client card's loyalty
 * documents — the loyalty catalogue, each loyalty account — are read back
 * through the card's own readers from the same bundle just before each is
 * written (`readLoyaltyWrites`), and the grants are held to the coupons
 * they grant (`readPromotionWrites`).
 *
 * Emulator-only by construction: refuses to run unless
 * FIRESTORE_EMULATOR_HOST is set, so it can never touch a real project.
 * Idempotent — fixed doc ids, `set()` overwrites, every instant derived from
 * the shop's calendar rather than the clock, and the stats written only when
 * their state-based answer changed. A second run on the same day writes the
 * same documents. Every busy day and waitlist request carries its TTL
 * `purgeAt`, stamped by the server's own `purgeAtFor` — never part of the
 * body.
 *
 * Run with the dev stack up (`pnpm run dev`):
 *   pnpm run seed:dev
 *
 * ### `--catalog-only`
 *   node tools/seed-dev-catalog.mjs --catalog-only
 * Writes the catalogue and stops after the booking policy: category,
 * locations, rosters, the busy days and the published exceptions, barbers
 * (their faces included), services. No staff account, client book, client
 * records, client avatars, promotions or stats. The e2e suite's global
 * setup runs it: each spec seeds the people and visits it asserts on, and
 * the client book's five hundred trigger runs would only load the
 * emulators under the suite. The book's shop calendar is still built,
 * because the busy fabrication starts where its appointment days end — so
 * in this mode those first days carry no busy at all. Nothing is deleted: a
 * book an earlier full run wrote stays. The loyalty catalogue is catalogue
 * too, and is written in this mode; the loyalty accounts are the book's,
 * and are not.
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
import { loadSeedDomain } from './seed/load-domain.mjs';

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

/*
 * The bundle first, in EVERY mode (see "Requirements" above): the bodies
 * are TypeScript, and so is the plan logic that places them.
 */
const seed = await loadSeedDomain();
const {
  BARBERS,
  CATEGORY,
  LOCATIONS,
  SCHEDULES,
  SERVICES,
  busyDayBody,
  busyKeyOf,
  closedDayBody,
  scheduleExceptionsFor,
} = seed.catalog;
const { CANCELLATION_WINDOW_HOURS, appointmentPhotoBody } = seed.appointments;
const { buildClientBook, searchFields } = seed.book;
const {
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
} = seed.loyalty;
const {
  COUPON_GRANTS_COLLECTION,
  couponGrantWritesOf,
  couponWritesOf,
  giftVoucherWritesOf,
  readPromotionWrites,
} = seed.promotions;
const { waitlistRequestWriteOf } = seed.waitlist;

/** A body as written: the body, and its TTL `purgeAt` when its group has one (F1-7). */
function stamped(path, body) {
  const purgeAt = seed.purgeAtFor(path.split('/'), body);
  return purgeAt === null ? body : { ...body, purgeAt };
}

const publicDir = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'apps/web/public',
);
const workDir = join(publicDir, 'work');

/** Uploads one local jpg into the Storage emulator, at the path its body names. */
async function upload(directory, file, path) {
  await bucket.file(path).save(readFileSync(join(directory, file)), {
    contentType: 'image/jpeg',
  });
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
 * Everything that can refuse does so BEFORE the first write: the bundle
 * (above), and every body the book is about to hold — each builder refuses
 * what its archetype cannot hold while the book is built.
 */
// Built in both modes: its calendar and its appointment days place the busy.
const clientBook = buildClientBook(Date.now());
const { calendar } = clientBook;

await db.doc(`serviceCategories/${CATEGORY.id}`).set(CATEGORY.body);

// Locations FIRST: seeding a roster fires the capacity trigger, which
// clamps windows to shop hours — hours that must already exist or the
// first materialization computes unclamped days. Every slot the booking
// flow computes is materialized against the shop's `timeZone`, never the
// device's — the §7.1 rule that a UTC server or a travelling client must
// still land on the shop's own calendar day.
for (const location of LOCATIONS) {
  await db.doc(`locations/${location.id}`).set(location.body);
  console.log(`seeded location ${location.id}`);
}

// NO document-level `locationId` on a roster: the location lives on each
// segment, so one barber's week can span shops. One open-ended version;
// `amend` closes it and appends the next.
for (const schedule of SCHEDULES) {
  await db.doc(`barberSchedules/${schedule.id}`).set(schedule.body);
  console.log(`seeded schedule for ${schedule.id}`);
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
 * against; in production the `rebuildBusy` trigger writes it from the
 * appointments.
 *
 * Days come from the shop's calendar (`tools/seed/calendar.mjs`), keyed by
 * Sofia's date whatever the machine's zone; the spans are minutes of that
 * shop day (`busyDayBody` merges them into the stored `BUSY` blocks), and
 * each day carries its TTL `purgeAt`.
 */
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
  const barberId = schedule.id;
  // eslint-disable-next-line security/detect-object-injection -- fixed keys.
  const pattern = BUSY_PATTERN[barberId] ?? [];
  for (let offset = APPOINTMENT_DAYS; offset < BUSY_HORIZON_DAYS; offset++) {
    const localDate = calendar.dayKeyAt(offset);

    // Vary the load so the calendar's per-day markers are not uniform — a
    // grid where every day looks identical proves nothing.
    const density = (offset * 7 + barberId.length) % 3;
    const spans = pattern
      .slice(0, density === 0 ? pattern.length : density)
      .map(([fromH, fromM, toH, toM]) => [fromH * 60 + fromM, toH * 60 + toM]);

    const path = `barberBusy/${busyKeyOf(barberId, localDate)}`;
    await db
      .doc(path)
      .set(stamped(path, busyDayBody(barberId, localDate, spans)));
  }
  console.log(
    `seeded busy days ${APPOINTMENT_DAYS}..${BUSY_HORIZON_DAYS} for ${barberId}` +
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
  const localDate = calendar.dayKeyAt(exception.dayOffset);
  const path = `scheduleExceptions/${busyKeyOf(exception.barberId, localDate)}`;
  await db
    .doc(path)
    .set(closedDayBody(exception.barberId, localDate, exception.locationId));
  console.log(`seeded ${path} (${exception.exceptionEffect})`);
}

const barbersDir = join(publicDir, 'barbers');
for (const barber of BARBERS) {
  await upload(barbersDir, barber.file, barber.body.avatarMediaPath);
  await db.doc(`barbers/${barber.id}`).set(barber.body);
  console.log(`seeded barber ${barber.id}`);
}

/*
 * ONE PHOTO, ONE OBJECT (wave D r6): the two bundles wear their first
 * member's photo — the SAME picture from the shop's library, not a second
 * copy under their own id — so every surface resolves it to one URL, and
 * the client card can tell one picture on two families from two pictures
 * (§3.3.3: the picture is the first family's, «Пълна грижа» and «Баща и
 * син» draw their letters). The booking pages still show it on both. The
 * body names the one object (`coverMediaPath`); each object goes up once.
 */
const uploadedCovers = new Set();
for (const service of SERVICES) {
  const { coverMediaPath } = service.body;
  if (!uploadedCovers.has(coverMediaPath)) {
    await upload(workDir, service.file, coverMediaPath);
    uploadedCovers.add(coverMediaPath);
  }
  await db.doc(`services/${service.id}`).set(service.body);
  console.log(
    `seeded ${service.id} (${service.body.offerings.length} offerings, ${service.body.variants.length} variants)`,
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
 * Field values mirror `BookingPolicy.withDefaults` (`@core/components`);
 * the body keeps its shape in flip 1 (blueprint §2.6).
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
  // The catalogue is read as the emulator will hold it: a rule the shop
  // published is read beside what is written, and is not written.
  const kept = publishedRules.map((streakId) => ({
    path: `streakDefinitions/${streakId}`,
    data: loyaltyCatalog.streakDefinitions[streakId],
  }));
  refuseUnreadable(readLoyaltyWrites(seed, [...writes, ...kept]));
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
    'catalogue only: no staff account, client book, client records, avatars, promotions, stats or loyalty accounts',
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
 * THEIR CLIENT RECORDS (D29, flip 1): `customers/{customerId}`, one per
 * seeded account, `customerOrigin: 'SEED'` — the shop's own copy of whom it
 * serves, bills and rewards. The id is DERIVED from the account
 * (`CustomerId.forUser(uid, sha256)`), as the booking transaction derives
 * it, so the appointments, grants, vouchers, photos and stats below name
 * the same record, and a booking by one of these accounts finds it instead
 * of creating its own.
 */
{
  const batch = db.batch();
  for (const { id, body } of clientBook.customers) {
    batch.set(db.doc(`customers/${id}`), body);
  }
  await batch.commit();
}
console.log(`seeded ${clientBook.customers.length} client records`);

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
 * Held to what they point at before anything is written: a grant to the
 * coupon it grants, at that coupon's value. A holder's grant the seed once
 * wrote and no longer does goes in the same batch; nobody else's grant is
 * touched.
 */
{
  const coupons = couponWritesOf();
  const grants = couponGrantWritesOf(clientBook, loyaltyCatalog, loyaltyToday);
  const vouchers = giftVoucherWritesOf(calendar);
  const writes = [...coupons, ...grants, ...vouchers];
  refuseUnreadable(readPromotionWrites(writes));
  const keep = new Set(writes.map(({ path }) => path));
  const batch = db.batch();
  for (const holder of LOYALTY_HOLDERS) {
    const held = await db
      .collection(COUPON_GRANTS_COLLECTION)
      .where('holderUserId', '==', holder.uid)
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
 * ### The document IS the flat `Appointment` body
 * Built by `appointmentBody` (`tools/seed/fixtures/appointments.fixtures.ts`,
 * `satisfies Omit<Appointment, 'id'>`), its query mirrors recomputed from
 * the seats by `AppointmentIndexSystem` as every write plan recomputes them:
 * the account keys (`ownerUserId`, `subjectUserIds`) beside the client
 * records (`ownerCustomerId`, `subjectCustomerIds`), `placement` included.
 */
const WRITE_BATCH = 200;
for (let i = 0; i < clientBook.appointments.length; i += WRITE_BATCH) {
  const batch = db.batch();
  for (const { id, doc } of clientBook.appointments.slice(i, i + WRITE_BATCH)) {
    batch.set(db.doc(`appointments/${id}`), doc);
  }
  await batch.commit();
}
{
  const days = clientBook.appointments.map(({ doc }) => doc.localDate).sort();
  console.log(
    `seeded ${clientBook.appointments.length} appointments, ${days[0]}..${days[days.length - 1]}` +
      ' (barberBusy for those days is rebuilt from them by the trigger)',
  );
}

/*
 * CLIENT STATS, as the trigger computes them — because it IS the trigger's
 * code (design §12.5.7, "the seed is engine output"): `projectClientStats`
 * from `@core/pipelines`, committed through the server's own
 * `firestoreCommitPlan` under the policy `firestoreSettingsPorts` reads,
 * bundled at start and run here in-process for every client RECORD on a
 * seat (`clientStats/{customerId}`, D29). State-based under a revision
 * guard, so it writes only what differs from what is stored.
 *
 * With the functions emulator up, `dispatchClientProjections` is recomputing
 * the same clients from the writes above at the same time. Both land on the
 * same answer; a transaction that loses the race to the other is retried,
 * and a recompute that still failed is run again. Without it
 * (`firestore,auth` only), this is the only writer — and the reason stats
 * exist at all in that setup.
 */
const statsProjection = seed.projectClientStats({
  commit: seed.firestoreCommitPlan(db),
  nowUtcMs: () => Date.now(),
  tenantTimeZone: LOCATIONS[0].body.timeZone,
  ...seed.firestoreSettingsPorts(db),
  log: () => {},
});

async function recomputeStats(customerId) {
  for (let attempt = 1; ; attempt += 1) {
    const answer = await statsProjection({ customerIds: [customerId] });
    if (!answer.ok) throw new Error(`seed: ${answer.error.errorCode}`);
    if (answer.value.failures.length === 0) return answer.value.written;
    if (attempt >= 4) {
      throw new Error(
        `seed: the stats of ${customerId} did not recompute: ${String(answer.value.failures[0])}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt));
  }
}

let statsWritten = 0;
for (const customerId of clientBook.subjectCustomerIds) {
  statsWritten += await recomputeStats(customerId);
}
console.log(
  `seeded clientStats + restricted/money for ${clientBook.subjectCustomerIds.length} clients` +
    ` (${statsWritten} written, ${clientBook.subjectCustomerIds.length - statsWritten} already current)`,
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
    seed,
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
  refuseUnreadable(readLoyaltyWrites(seed, writes));
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
 * as the visit sheet's shutter writes one (`uploadPhotoBytes`, then
 * `saveAppointmentPhoto`): the object at
 * `appointmentPhotos/{appointmentId}/{photoId}` with the facts as its
 * metadata under the archetype's key names, and the flat
 * `AppointmentPhoto` body beside it (`appointmentPhotoBody`), naming his
 * client RECORD. `appointmentPhotos/**` is staff-only in Storage, so the
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
    const [barberId] = visit.barberIds;
    const body = appointmentPhotoBody({
      appointmentId: visit.appointmentId,
      barberId,
      clientUserId: uid,
      clientLabel,
      takenByUserId: STAFF_UID,
      takenAtUtcMs: visit.doneMs,
      path,
      url:
        `http://${process.env.FIREBASE_STORAGE_EMULATOR_HOST}/v0/b/${BUCKET}` +
        `/o/${encodeURIComponent(path)}?alt=media&token=${token}`,
      width: 1100,
      height: 1400,
    });
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
          appointmentId: body.appointmentId,
          barberId: body.barberId,
          clientCustomerId: body.clientCustomerId,
          clientLabel: body.clientLabel,
          takenByUserId: body.takenByUserId,
          takenAtUtcMs: String(body.takenAtUtcMs),
        },
      },
    });
    await ref.set(body);
  }
  console.log(`seeded ${recent.length} photos of ${uid}'s last visits`);
}

/*
 * МАРТИН IS WAITING (§4.6; the card's waitlist row): an open request for
 * Thursday and Friday afternoons next week, made last night after every
 * booking of his (`tools/seed/waitlist.mjs`), the flat `WaitlistRequest`
 * body with its TTL `purgeAt`.
 */
{
  const { path, data } = waitlistRequestWriteOf(clientBook);
  await db.doc(path).set(stamped(path, data));
  console.log(`seeded ${path} (${data.localDates.join(', ')}, afternoons)`);
}

console.log(
  `Done: ${SERVICES.length} services + ${BARBERS.length} barbers + ${LOCATIONS.length} locations + ${SCHEDULES.length} rosters + 1 category + booking policy` +
    ` + ${clientBook.users.length} clients with ${clientBook.appointments.length} appointments in the ${PROJECT_ID} emulators.`,
);
process.exit(0);
