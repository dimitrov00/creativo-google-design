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

const workDir = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'apps/web/public/work',
);

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
    priceMinorUnits: 3000,
    durationMinutes: 45,
    popular: true,
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
    priceMinorUnits: 3500,
    durationMinutes: 50,
    popular: true,
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
    priceMinorUnits: 2000,
    durationMinutes: 30,
    popular: false,
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
    priceMinorUnits: 4000,
    durationMinutes: 60,
    popular: false,
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
    priceMinorUnits: 4500,
    durationMinutes: 60,
    popular: true,
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
    priceMinorUnits: 1500,
    durationMinutes: 20,
    popular: false,
    sortOrder: 6,
  },
];

await db
  .collection('serviceCategories')
  .doc(CATEGORY.id)
  .set({ name: CATEGORY.name, sortOrder: CATEGORY.sortOrder });

for (const service of SERVICES) {
  const cover = await uploadCover(service.file, service.id);
  await db.collection('services').doc(service.id).set({
    name: service.name,
    description: service.description,
    categoryId: CATEGORY.id,
    priceMinorUnits: service.priceMinorUnits,
    currencyCode: 'BGN',
    durationMinutes: service.durationMinutes,
    cover,
    locationIds: [],
    conflictsWith: [],
    offering: { kind: 'single' },
    upsellOnly: false,
    popular: service.popular,
    status: 'active',
    sortOrder: service.sortOrder,
  });
  console.log(`seeded ${service.id}`);
}

console.log(
  `Done: ${SERVICES.length} services + 1 category in the ${PROJECT_ID} emulators.`,
);
process.exit(0);
