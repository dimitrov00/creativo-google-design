/**
 * Seeds the Firebase EMULATORS with a small barbershop catalog so the
 * onboarding services grid (and anything else reading `CatalogReader`) has
 * real data to render in dev: one category, six single services with cover
 * art uploaded to the Storage emulator from `apps/web/public/work/`.
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
 * The roster the landing has been rendering from hand-authored content.
 * Seeded so both surfaces read one catalog — note `Barber` carries no
 * `rating` on purpose ("fabricated ratings read as a scam"), so the stars
 * the static content showed have no counterpart here.
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

const CATEGORY = {
  id: 'cat-hair',
  name: { bg: 'Коса и брада', en: 'Hair & beard' },
  sortOrder: 1,
};

const SERVICES = [
  {
    id: 'svc-classic-cut',
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
      { barberId: 'ivan', base: terms(14.5, 35), byVariant: { short: terms(14.5, 35), long: terms(18.5, 50) } },
      { barberId: 'niko', base: terms(13, 30), byVariant: { short: terms(13, 30), long: terms(16.5, 45) } },
      { barberId: 'stefan', base: terms(15, 45) },
    ],
    sortOrder: 1,
  },
  {
    id: 'svc-fade',
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
      { barberId: 'ivan', base: terms(19, 55), byVariant: { long: terms(23, 70) } },
      { barberId: 'stefan', base: terms(20.5, 60) },
    ],
    sortOrder: 4,
  },
  {
    id: 'svc-modern-cut',
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
];

await db
  .collection('serviceCategories')
  .doc(CATEGORY.id)
  .set({ name: CATEGORY.name, sortOrder: CATEGORY.sortOrder });

for (const barber of BARBERS) {
  const avatar = await uploadAvatar(barber.file, barber.id);
  await db.collection('barbers').doc(barber.id).set({
    name: barber.name,
    handle: barber.handle,
    title: barber.title,
    bio: barber.bio,
    avatar,
    yearsExperience: barber.yearsExperience,
    locationIds: [],
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
      conflictsWith: [],
      composition: { kind: 'single' },
      upsellOnly: false,
      popular: service.popular,
      status: 'active',
      sortOrder: service.sortOrder,
    });
  console.log(
    `seeded ${service.id} (${service.offerings.length} offerings, ${service.variants.length} variants)`,
  );
}

console.log(
  `Done: ${SERVICES.length} services + ${BARBERS.length} barbers + 1 category in the ${PROJECT_ID} emulators.`,
);
process.exit(0);
