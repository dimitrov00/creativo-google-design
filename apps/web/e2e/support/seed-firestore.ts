import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { workspaceRoot } from '@nx/devkit';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import type { LoyaltyAccountFixture } from '@creativo/application/engagement/testing';
import {
  upcomingAppointmentDocument,
  workedAppointmentDocument,
} from './appointment-seed-document';

const PROJECT_ID = 'demo-creativo-test';
/** `environment.ts`'s bucket, and the dev seed's. */
const BUCKET = 'demo-creativo-test.appspot.com';

// Must be set before the Admin SDK's Firestore client is first constructed —
// mirrors `mint-custom-token.ts`'s `FIREBASE_AUTH_EMULATOR_HOST` handling for
// the Auth emulator; same port as `firebase.json`'s `emulators.firestore`.
process.env['FIRESTORE_EMULATOR_HOST'] ??= '127.0.0.1:8080';
// Same for Storage (`firebase.json`'s `emulators.storage`).
process.env['FIREBASE_STORAGE_EMULATOR_HOST'] ??= '127.0.0.1:9199';

function adminApp() {
  return (
    getApps().find((candidate) => candidate.name === '[DEFAULT]') ??
    initializeApp({ projectId: PROJECT_ID })
  );
}

/**
 * Seeds a `users/{uid}` doc directly via the Admin SDK (bypasses Firestore
 * Security Rules), matching `FirestoreProfileAdapter`'s persisted shape
 * (`libs/infrastructure/firestore/src/lib/profile.adapter.ts`). No seeding
 * helper existed yet for E2E — this is the first one, following
 * `mint-custom-token.ts`'s app-reuse pattern.
 */
export async function seedUserProfile(
  uid: string,
  overrides: {
    firstName?: string;
    lastName?: string;
    phone?: string;
    birthDate?: string | null;
  } = {},
): Promise<void> {
  await getFirestore(adminApp())
    .collection('users')
    .doc(uid)
    .set({
      phone: overrides.phone ?? '+14155550100',
      firstName: overrides.firstName ?? 'Ada',
      lastName: overrides.lastName ?? 'Lovelace',
      roles: ['client'],
      status: { kind: 'active' },
      email: null,
      birthDate: overrides.birthDate ?? null,
      searchName: `${(overrides.firstName ?? 'Ada').toLowerCase()} ${(overrides.lastName ?? 'Lovelace').toLowerCase()}`,
      searchPrefixes: [],
    });
}

/** A 1×1 PNG: the smallest image the avatar lookup can find. */
const PHOTO_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

/**
 * Puts a profile photo where `AvatarUploader.find` looks
 * (`avatars/{uid}/original`), which is what completes a profile's last
 * checklist item.
 */
export async function seedProfilePhoto(uid: string): Promise<void> {
  await getStorage(adminApp())
    .bucket(BUCKET)
    .file(`avatars/${uid}/original`)
    .save(PHOTO_PNG, { contentType: 'image/png' });
}

/**
 * Seeds `appointments/{id}`: a confirmed visit `ownerUserId` booked for
 * themselves in the dev catalogue's chair, starting at the naive shop-time
 * `startIso` — the document {@link upcomingAppointmentDocument} builds, which
 * `apps/web/src/testing/e2e-appointment-seed.spec.ts` holds to the real
 * mapper byte for byte.
 *
 * A screen that shows the service or the barber also needs the dev
 * catalogue, which `global-setup.ts` seeds once per run.
 */
export async function seedUpcomingAppointment(
  id: string,
  ownerUserId: string,
  startIso: string,
): Promise<void> {
  await getFirestore(adminApp())
    .collection('appointments')
    .doc(id)
    .set(upcomingAppointmentDocument(id, ownerUserId, startIso));
}

/**
 * Seeds `appointments/{id}`: a finished visit `ownerUserId` booked for
 * themselves in the dev catalogue's chair, worked at the naive shop-time
 * `startIso` — the document {@link workedAppointmentDocument} builds. The
 * visit a client repeats with `/book?repeat=`.
 */
export async function seedWorkedAppointment(
  id: string,
  ownerUserId: string,
  startIso: string,
): Promise<void> {
  await getFirestore(adminApp())
    .collection('appointments')
    .doc(id)
    .set(workedAppointmentDocument(id, ownerUserId, startIso));
}

/**
 * Every stored appointment `ownerUserId` booked, raw, with its id — what the
 * server FILED, for the fields no screen shows (a rebooking edge, the
 * barbers it froze).
 */
export async function readAppointmentsOwnedBy(
  ownerUserId: string,
): Promise<({ readonly id: string } & Record<string, unknown>)[]> {
  const snapshot = await getFirestore(adminApp())
    .collection('appointments')
    .where('ownerUserId', '==', ownerUserId)
    .get();
  return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
}

/**
 * Reads back `appointments/{id}`'s persisted `status.kind` directly via the
 * Admin SDK — used to prove a cancel-own flow actually persisted the
 * domain transition (goal 6.4), not just updated the UI optimistically.
 */
export async function readAppointmentStatusKind(
  id: string,
): Promise<string | null> {
  const snapshot = await getFirestore(adminApp())
    .collection('appointments')
    .doc(id)
    .get();
  const data = snapshot.data() as { status?: { kind?: string } } | undefined;
  return data?.status?.kind ?? null;
}

/**
 * Reads back how the first seat of `appointments/{id}` was cancelled — who
 * called it off and the reason kind filed — or `null` while it is not a
 * cancellation. What the server FILED, which the screen cannot show.
 */
export async function readSeatCancellation(
  id: string,
): Promise<{ by: string; reason: string } | null> {
  const snapshot = await getFirestore(adminApp())
    .collection('appointments')
    .doc(id)
    .get();
  const data = snapshot.data() as
    | {
        seats?: {
          outcome?: { kind?: string; by?: string; reason?: { kind?: string } };
        }[];
      }
    | undefined;
  const outcome = data?.seats?.[0]?.outcome;
  if (outcome?.kind !== 'cancelled') return null;
  return { by: outcome.by ?? '', reason: outcome.reason?.kind ?? '' };
}

// ── The staff client card (client-card-redesign §7.3, WP7 → WP8) ────────

/**
 * A HELD REWARD for `uid`: the dev seed's punch-card coupon — «Безплатно
 * подстригване», a free service, exclusive — and one active, single-use
 * grant of it, the one the visit sheet reads for the booker
 * (`findUsableForUser`: the user, `state.kind == 'active'`, joined with the
 * coupon). The coupon is the FULL seed's promotion, which `--catalog-only`
 * does not write, so it is written here with the seed's own id and
 * document shape (`tools/seed-dev-catalog.mjs` COUPONS / COUPON_GRANTS);
 * the grant's id is the attempt's. Returns the grant's id.
 */
export async function seedHeldReward(uid: string): Promise<string> {
  const db = getFirestore(adminApp());
  const couponId = 'coupon-punch-free-cut';
  await db
    .collection('coupons')
    .doc(couponId)
    .set({
      name: 'Безплатно подстригване',
      code: null,
      value: { kind: 'free_service' },
      combinability: { kind: 'exclusive' },
      expiry: { kind: 'never' },
      enabled: true,
    });
  const grantId = `grant-${uid}-punch`;
  await db
    .collection('couponGrants')
    .doc(grantId)
    .set({
      id: grantId,
      userId: uid,
      couponId,
      value: { kind: 'free_service' },
      grantedAt: new Date().toISOString(),
      state: {
        kind: 'active',
        capacity: { kind: 'single_use' },
        expiration: { kind: 'no_expiry' },
      },
    });
  return grantId;
}

/**
 * THE BIRTHDAY GIFT for `uid` (client-card-revision-3 §2.1.2 a, §4.6): the
 * dev seed's «Рожден ден» coupon — −20 %, exclusive, valid 30 days, and
 * carrying `occasion: 'birthday'`, which is what makes a grant of it THE
 * gift the glance's band heads (never its name) — and one active grant of
 * it for the attempt's client. The coupon is the FULL seed's promotion
 * (`tools/seed/promotions.mjs` COUPONS), which `--catalog-only` does not
 * write, so it is written here with the seed's own id and document shape;
 * the grant's id is the attempt's. Returns the grant's id.
 */
export async function seedBirthdayGift(uid: string): Promise<string> {
  const db = getFirestore(adminApp());
  const couponId = 'coupon-birthday';
  await db
    .collection('coupons')
    .doc(couponId)
    .set({
      name: 'Рожден ден',
      code: null,
      value: { kind: 'percent_off', percent: 20 },
      combinability: { kind: 'exclusive' },
      expiry: { kind: 'days', days: 30 },
      usageLimit: null,
      enabled: true,
      occasion: 'birthday',
    });
  const grantId = `grant-${uid}-birthday`;
  await db
    .collection('couponGrants')
    .doc(grantId)
    .set({
      id: grantId,
      userId: uid,
      couponId,
      value: { kind: 'percent_off', percent: 20 },
      grantedAt: new Date().toISOString(),
      state: {
        kind: 'active',
        capacity: { kind: 'single_use' },
        expiration: { kind: 'no_expiry' },
      },
    });
  return grantId;
}

/**
 * Seeds a client's loyalty as the engine holds it — `loyaltyAccounts/{uid}`
 * with its `badgeProgress` and `seasonProgress`, and the point rows in
 * `clientJournal` — from one of the A0 fixtures
 * (`libs/application/engagement/src/testing/fixtures/loyalty/account-*.json`,
 * read by the spec as JSON: Playwright cannot load the domain libs the
 * testing entry imports). The fixture is deep-frozen upstream, so it is
 * copied; the account's `userId`, every row's `userId` and every row's id
 * (`{uid}_{seq:06}`, the fixture's own key with its uid swapped) are
 * rewritten to `uid`. Award and idempotency keys keep the fixture's uid:
 * nothing reads them back. The loyalty CATALOGUE is the dev seed's, which
 * `global-setup.ts` writes (`--catalog-only`).
 */
export async function seedLoyalty(
  uid: string,
  fixture: LoyaltyAccountFixture,
): Promise<void> {
  const copy = structuredClone(fixture);
  const from = copy.account.userId;
  const db = getFirestore(adminApp());
  const batch = db.batch();
  const account = db.collection('loyaltyAccounts').doc(uid);
  batch.set(account, { ...copy.account, userId: uid });
  for (const [seriesId, progress] of Object.entries(copy.badgeProgress)) {
    batch.set(account.collection('badgeProgress').doc(seriesId), progress);
  }
  for (const [seasonId, progress] of Object.entries(copy.seasonProgress)) {
    batch.set(account.collection('seasonProgress').doc(seasonId), progress);
  }
  for (const [rowId, row] of Object.entries(copy.clientJournal)) {
    const id = rowId.startsWith(`${from}_`)
      ? `${uid}${rowId.slice(from.length)}`
      : rowId;
    batch.set(db.collection('clientJournal').doc(id), { ...row, userId: uid });
  }
  await batch.commit();
}

/** One visit on a client's stats: the appointment and its start, UTC ISO. */
export interface ClientStatsFactSeed {
  readonly appointmentId: string;
  readonly at: string;
}

/** A visit the stats point at («last», «next»): its services, chairs and seats. */
export interface ClientStatsVisitSeed extends ClientStatsFactSeed {
  readonly serviceIds: readonly string[];
  readonly barberIds: readonly string[];
  readonly legs: readonly {
    readonly seatId: string;
    readonly serviceId: string;
    readonly variantId: string | null;
    readonly barberId: string;
    readonly minutes: number;
  }[];
}

/**
 * `clientStats/{uid}`'s content as `clientStatsContent` writes it
 * (`libs/application/booking/src/lib/ports/client-stats-document.ts`) —
 * hand-written for the reason `appointment-seed-document.ts` gives, and
 * read back by the app through `clientStatsFromDocument`.
 */
export interface ClientStatsSeed {
  readonly lifetime: {
    readonly visitsCompleted: number;
    readonly noShows: number;
    readonly lateCancels: number;
    readonly clientCancels: number;
  };
  readonly last365: {
    readonly visitsCompleted: readonly ClientStatsFactSeed[];
    readonly noShows: readonly ClientStatsFactSeed[];
    readonly lateCancels: readonly ClientStatsFactSeed[];
  };
  readonly firstVisitAt: string | null;
  readonly lastVisit: ClientStatsVisitSeed | null;
  readonly nextVisit: ClientStatsVisitSeed | null;
  readonly avgCadenceDays: number | null;
  readonly preferredBarberId: string | null;
  readonly usualServiceIds: readonly string[];
  readonly pauseSuggestion: null;
}

/**
 * Writes `clientStats/{uid}` directly — AFTER the function triggers have
 * gone quiet (`tools/seed/settle.mjs`, run as a CLI: this project may not
 * import tooling), so the appointments trigger the spec's own seeding set
 * off cannot recompute over it. `sinceMs` is when that seeding began, so a
 * trigger that died meanwhile is reported by name. The version is far
 * ahead of any a recompute could reach in a run.
 */
export async function seedClientStats(
  uid: string,
  stats: ClientStatsSeed,
  sinceMs: number = Date.now(),
): Promise<void> {
  await promisify(execFile)(
    'node',
    ['tools/seed/settle.mjs', `--since=${sinceMs}`],
    { cwd: workspaceRoot },
  );
  await getFirestore(adminApp())
    .collection('clientStats')
    .doc(uid)
    .set({
      userId: uid,
      ...stats,
      version: 1_000,
      updatedAt: new Date().toISOString(),
    });
}

/** One of the shop's work shots — the picture a seeded cut shows (1100 × 1400). */
const WORK_SHOT = 'apps/web/public/work/fade-styling.jpg';

/**
 * Puts a past cut on `appointmentId` as the visit sheet's shutter does
 * (`FirebaseAppointmentPhotos.attach`), the way the dev seed does (§4.6):
 * the JPEG at `appointmentPhotos/{appointmentId}/{photoId}` with the facts
 * as its metadata and a download token, and `appointmentPhotos/{photoId}`
 * beside it with every field `toPhoto` reads and the TOKENED url —
 * `appointmentPhotos/**` is staff-only in Storage, so a bare path would not
 * render. Returns the photo's id (`client-photo-{id}` on the card).
 */
export async function seedAppointmentPhoto(
  appointmentId: string,
  uid: string,
  options: {
    readonly barberId?: string;
    readonly clientLabel?: string;
    readonly takenAtIso?: string;
  } = {},
): Promise<string> {
  const photoId = `photo-${appointmentId}`;
  const path = `appointmentPhotos/${appointmentId}/${photoId}`;
  const token = randomUUID();
  const barberId = options.barberId ?? 'ivan';
  const clientLabel = options.clientLabel ?? 'Ada Lovelace';
  const takenAtIso = options.takenAtIso ?? new Date().toISOString();
  const app = adminApp();
  await getStorage(app)
    .bucket(BUCKET)
    .file(path)
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- a fixed picture of the app's own.
    .save(readFileSync(join(workspaceRoot, WORK_SHOT)), {
      contentType: 'image/jpeg',
      metadata: {
        metadata: {
          firebaseStorageDownloadTokens: token,
          appointmentId,
          barberId,
          clientUserId: uid,
          clientLabel,
          takenByUid: null,
          takenAtIso,
        },
      },
    });
  await getFirestore(app)
    .collection('appointmentPhotos')
    .doc(photoId)
    .set({
      photoId,
      appointmentId,
      barberId,
      clientUserId: uid,
      clientLabel,
      takenByUid: null,
      takenAtIso,
      path,
      url:
        `http://${process.env['FIREBASE_STORAGE_EMULATOR_HOST']}/v0/b/${BUCKET}` +
        `/o/${encodeURIComponent(path)}?alt=media&token=${token}`,
      width: 1100,
      height: 1400,
      origin: 'shot',
      label: null,
    });
  return photoId;
}
