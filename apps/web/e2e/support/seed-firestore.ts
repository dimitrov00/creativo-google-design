import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { workspaceRoot } from '@nx/devkit';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import type { LoyaltyAccountFixture } from '@creativo/application/engagement/testing';
import {
  type ClientStats,
  Combinability,
  CouponExpiryRule,
  CouponOccasion,
  CouponStatus,
  CouponValue,
  CustomerOrigin,
  Email,
  GrantCapacityTerms,
  GrantExpiryTerms,
  GrantLifecycle,
  NotificationPayload,
  PhotoOrigin,
  PolicyPassStamp,
} from '@core/components';
import {
  type AppointmentPhoto,
  type ClientStatsRecord,
  Collections,
  type Coupon,
  type CouponGrant,
  type Customer,
  type InboxNotification,
  Profile,
  Subcollections,
} from '@core/entities';
import {
  AppointmentId,
  BarberId,
  CouponId,
  CustomerId,
  LocalDate,
  MinuteOfDay,
  type Result,
  type TimeZone,
  UserId,
  type UtcEpochMs,
} from '@core/primitives';
import {
  PhoneSystem,
  SearchFieldsSystem,
  ZonedTimeSystem,
} from '@core/systems';
import {
  SHOP_ZONE,
  upcomingAppointmentBody,
  workedAppointmentBody,
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

/** A smart constructor's answer for a seed value that is one by construction. */
function sure<T, E>(result: Result<T, E>, what: string): T {
  if (!result.ok) throw new Error(`e2e seed: ${what} is not valid`);
  return result.value;
}

const SHOP_TIME_ZONE: TimeZone = sure(
  ZonedTimeSystem.checkZone(SHOP_ZONE),
  SHOP_ZONE,
);

/** An instant on the shop's wall clock — `day` at `hour:minute`, read in its zone. */
function shopInstant(day: string, hour: number, minute = 0): UtcEpochMs {
  return sure(
    ZonedTimeSystem.toUtc(
      sure(LocalDate.parse(day), day),
      sure(MinuteOfDay.of(hour * 60 + minute), `${hour}:${minute}`),
      SHOP_TIME_ZONE,
    ),
    `${day} ${hour}:${minute}`,
  );
}

/**
 * The seed's fixed instants: a body is the same bytes on every run (no
 * `Date.now()` in a body). A record opened before every visit a spec
 * seeds; a grant, a stats write and a photo at one noon on the shop's clock.
 */
const RECORD_OPENED_AT_UTC_MS = shopInstant('2025-01-01', 12);
const SEEDED_AT_UTC_MS = shopInstant('2026-09-01', 12);

/** The `hash` port's production function: sha256 of the UTF-8 input, lower-case hex. */
const sha256Hex = (input: string): string =>
  createHash('sha256').update(input, 'utf8').digest('hex');

/**
 * `uid`'s client RECORD id (D29) — derived as the booking pipeline derives
 * it (`CustomerId.forUser` over the production hash), so a booking the spec
 * makes through the app finds the record the seed wrote, at the same id.
 */
export function customerIdFor(uid: string): CustomerId {
  return CustomerId.forUser(UserId.of(uid), sha256Hex);
}

/**
 * Seeds `customers/{customerIdFor(uid)}`: the record a first booking opens
 * (flatten-spec §5.5), from the account's own profile — the name the shop
 * calls them, the contact as the desk's copy, the search keys
 * `SearchFieldsSystem` derives — so the staff card's record lookup
 * (`customers where userId == uid`) finds it. Seed `users/{uid}` first.
 */
export async function seedCustomerRecord(uid: string): Promise<CustomerId> {
  const db = getFirestore(adminApp());
  const profile = (
    await db.collection(Collections.Users).doc(uid).get()
  ).data();
  if (profile === undefined) {
    throw new Error(`e2e seed: ${uid} has no profile to open a record from`);
  }
  const contact = {
    firstName: String(profile['firstName'] ?? ''),
    lastName: String(profile['lastName'] ?? ''),
  };
  const parsed = PhoneSystem.parse(String(profile['phone'] ?? ''), null);
  const phone = parsed.ok ? parsed.value.e164 : null;
  const rawEmail = profile['email'];
  const email = typeof rawEmail === 'string' ? Email.parse(rawEmail) : null;
  const id = customerIdFor(uid);
  const body = {
    userId: UserId.of(uid),
    displayName: Profile.fullName(contact),
    phone,
    email,
    ...SearchFieldsSystem.searchFields(
      contact.firstName,
      contact.lastName,
      phone,
      email,
    ),
    createdAtUtcMs: RECORD_OPENED_AT_UTC_MS,
    customerOrigin: CustomerOrigin.Seed,
  } satisfies Omit<Customer, 'id'>;
  await db.collection(Collections.Customers).doc(id).set(body);
  return id;
}

/**
 * Seeds `appointments/{id}`: a confirmed visit `ownerUserId` booked for
 * themselves in the dev catalogue's chair, starting at `startsAt` (a naive
 * shop wall clock, `YYYY-MM-DDTHH:mm:ss`, read in the shop's zone at this
 * boundary) — the flat body {@link upcomingAppointmentBody} builds, which
 * `apps/web/src/testing/e2e-appointment-seed.spec.ts` holds to the
 * archetype — and the owner's client record beside it.
 *
 * A screen that shows the service or the barber also needs the dev
 * catalogue, which `global-setup.ts` seeds once per run.
 */
export async function seedUpcomingAppointment(
  id: string,
  ownerUserId: string,
  startsAt: string,
): Promise<void> {
  const customerId = await seedCustomerRecord(ownerUserId);
  await getFirestore(adminApp())
    .collection(Collections.Appointments)
    .doc(id)
    .set(upcomingAppointmentBody(id, ownerUserId, customerId, startsAt));
}

/**
 * Seeds `appointments/{id}`: a finished visit `ownerUserId` booked for
 * themselves in the dev catalogue's chair, worked at the naive shop-time
 * `startsAt` — the body {@link workedAppointmentBody} builds — and the
 * owner's client record. The visit a client repeats with `/book?repeat=`.
 */
export async function seedWorkedAppointment(
  id: string,
  ownerUserId: string,
  startsAt: string,
): Promise<void> {
  const customerId = await seedCustomerRecord(ownerUserId);
  await getFirestore(adminApp())
    .collection(Collections.Appointments)
    .doc(id)
    .set(workedAppointmentBody(id, ownerUserId, customerId, startsAt));
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
    .collection(Collections.Appointments)
    .where('ownerUserId', '==', ownerUserId)
    .get();
  return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
}

/**
 * Reads back `appointments/{id}`'s stored `bookingStatus` directly via the
 * Admin SDK — used to prove a cancel-own flow actually persisted the
 * domain transition (goal 6.4), not just updated the UI optimistically.
 */
export async function readBookingStatus(id: string): Promise<string | null> {
  const snapshot = await getFirestore(adminApp())
    .collection(Collections.Appointments)
    .doc(id)
    .get();
  const status = snapshot.get('bookingStatus') as unknown;
  return typeof status === 'string' ? status : null;
}

/**
 * Reads back how the first seat of `appointments/{id}` was cancelled — who
 * called it off and the reason filed, as the flat seat stores them — or
 * `null` while it is not a cancellation. What the server FILED, which the
 * screen cannot show.
 */
export async function readSeatCancellation(
  id: string,
): Promise<{ cancelledBy: string; cancellationReason: string } | null> {
  const snapshot = await getFirestore(adminApp())
    .collection(Collections.Appointments)
    .doc(id)
    .get();
  const seats = snapshot.get('seats') as
    readonly Record<string, unknown>[] | undefined;
  const seat = seats?.[0];
  if (seat?.['attendanceState'] !== 'CANCELLED') return null;
  return {
    cancelledBy: String(seat['cancelledBy'] ?? ''),
    cancellationReason: String(seat['cancellationReason'] ?? ''),
  };
}

// ── The staff client card (client-card-redesign §7.3, WP7 → WP8) ────────

/** A coupon of the dev seed's promotions: open to everyone, unlimited, `couponStatus: 'ENABLED'`. */
const LISTED = {
  usageLimit: null,
  couponStatus: CouponStatus.Enabled,
  couponOccasion: null,
} as const;

/**
 * One active, single-use grant of `couponId` at its `value`, rewarding
 * `uid`'s client RECORD and read by their account (D29) — granted at the
 * seed's fixed instant.
 */
function activeGrantOf(uid: string, couponId: CouponId, value: CouponValue) {
  return {
    customerId: customerIdFor(uid),
    holderUserId: UserId.of(uid),
    couponId,
    grantedAtUtcMs: SEEDED_AT_UTC_MS,
    ...CouponValue.of(value),
    ...GrantLifecycle.of(
      GrantLifecycle.active(
        GrantCapacityTerms.singleUse(),
        GrantExpiryTerms.none(),
      ),
    ),
  } satisfies Omit<CouponGrant, 'id'>;
}

/**
 * A HELD REWARD for `uid`: the dev seed's punch-card coupon — «Безплатно
 * подстригване», a free service, exclusive — and one active, single-use
 * grant of it, the one the visit sheet reads for the booker (the client
 * record, `grantStatus == 'ACTIVE'`, joined with the coupon). The coupon is
 * the FULL seed's promotion, which `--catalog-only` does not write, so it
 * is written here with the seed's own id and flat body
 * (`tools/seed/fixtures/promotions.fixtures.ts` COUPONS); the grant's id is
 * the attempt's. Returns the grant's id.
 */
export async function seedHeldReward(uid: string): Promise<string> {
  const db = getFirestore(adminApp());
  const couponId = CouponId.of('coupon-punch-free-cut');
  const coupon = {
    ...LISTED,
    name: 'Безплатно подстригване',
    code: null,
    combinability: Combinability.Exclusive,
    ...CouponValue.freeService(),
    ...CouponExpiryRule.never(),
  } satisfies Omit<Coupon, 'id'>;
  await db.collection(Collections.Coupons).doc(couponId).set(coupon);
  const grantId = `grant-${uid}-punch`;
  await db
    .collection(Collections.CouponGrants)
    .doc(grantId)
    .set(activeGrantOf(uid, couponId, coupon));
  return grantId;
}

/**
 * THE BIRTHDAY GIFT for `uid` (client-card-revision-3 §2.1.2 a, §4.6): the
 * dev seed's «Рожден ден» coupon — −20 %, exclusive, valid 30 days, and
 * carrying `couponOccasion: 'BIRTHDAY'`, which is what makes a grant of it
 * THE gift the glance's band heads (never its name) — and one active grant
 * of it for the attempt's client. The coupon is the FULL seed's promotion
 * (`tools/seed/fixtures/promotions.fixtures.ts` COUPONS), which
 * `--catalog-only` does not write, so it is written here with the seed's own
 * id and flat body; the grant's id is the attempt's. Returns the grant's id.
 */
export async function seedBirthdayGift(uid: string): Promise<string> {
  const db = getFirestore(adminApp());
  const couponId = CouponId.of('coupon-birthday');
  const coupon = {
    ...LISTED,
    name: 'Рожден ден',
    code: null,
    combinability: Combinability.Exclusive,
    ...sure(CouponValue.percentOff(20), 'twenty per cent'),
    ...sure(CouponExpiryRule.days(30), 'thirty days'),
    couponOccasion: CouponOccasion.Birthday,
  } satisfies Omit<Coupon, 'id'>;
  await db.collection(Collections.Coupons).doc(couponId).set(coupon);
  const grantId = `grant-${uid}-birthday`;
  await db
    .collection(Collections.CouponGrants)
    .doc(grantId)
    .set(activeGrantOf(uid, couponId, coupon));
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

/**
 * `clientStats/{customerId}`'s stats as the projection computes them — the
 * flat `ClientStats` slice of the `ClientStatsRecord` archetype (counts,
 * the bounded facts on the shop's wall clock, the first/last/next visit,
 * the pause suggestion), every field at the root. The record's key and
 * write stamps are {@link seedClientStats}'s.
 */
export type ClientStatsSeed = ClientStats;

/**
 * Writes `clientStats/{customerIdFor(uid)}` directly — AFTER the function
 * triggers have gone quiet (`tools/seed/settle.mjs`, run as a CLI: this
 * project may not import tooling), so the appointments trigger the spec's
 * own seeding set off cannot recompute over it. `sinceMs` is when that
 * seeding began, so a trigger that died meanwhile is reported by name. The
 * version is far ahead of any a recompute could reach in a run; no policy
 * pass has judged it.
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
  const customerId = customerIdFor(uid);
  const body = {
    customerId,
    ...stats,
    version: 1_000,
    updatedAtUtcMs: SEEDED_AT_UTC_MS,
    ...PolicyPassStamp.NONE,
  } satisfies Omit<ClientStatsRecord, 'id'>;
  await getFirestore(adminApp())
    .collection(Collections.ClientStats)
    .doc(customerId)
    .set(body);
}

/** One of the shop's work shots — the picture a seeded cut shows (1100 × 1400). */
const WORK_SHOT = 'apps/web/public/work/fade-styling.jpg';

/**
 * Puts a past cut on `appointmentId` as the visit sheet's shutter does
 * (`uploadPhotoBytes`, then `saveAppointmentPhoto`), the way the dev seed
 * does (§4.6): the JPEG at `appointmentPhotos/{appointmentId}/{photoId}`
 * with the facts as its metadata under the archetype's key names and a
 * download token, and `appointmentPhotos/{photoId}` beside it — the flat
 * `AppointmentPhoto` body, naming `uid`'s client RECORD, with the TOKENED
 * url (`appointmentPhotos/**` is staff-only in Storage, so a bare path would
 * not render). `takenAt` is an ISO instant WITH its offset, read at this
 * boundary. Returns the photo's id (`client-photo-{id}` on the card).
 */
export async function seedAppointmentPhoto(
  appointmentId: string,
  uid: string,
  options: {
    readonly barberId?: string;
    readonly clientLabel?: string;
    readonly takenAt?: string;
  } = {},
): Promise<string> {
  const photoId = `photo-${appointmentId}`;
  const path = `appointmentPhotos/${appointmentId}/${photoId}`;
  const token = randomUUID();
  const takenAtUtcMs =
    options.takenAt === undefined
      ? SEEDED_AT_UTC_MS
      : sure(ZonedTimeSystem.parseOffsetIso(options.takenAt), 'taken at');
  const body = {
    appointmentId: AppointmentId.of(appointmentId),
    barberId: BarberId.of(options.barberId ?? 'ivan'),
    clientCustomerId: customerIdFor(uid),
    clientLabel: options.clientLabel ?? 'Ada Lovelace',
    takenByUserId: null,
    takenAtUtcMs,
    path,
    url:
      `http://${process.env['FIREBASE_STORAGE_EMULATOR_HOST']}/v0/b/${BUCKET}` +
      `/o/${encodeURIComponent(path)}?alt=media&token=${token}`,
    width: 1100,
    height: 1400,
    photoOrigin: PhotoOrigin.Shot,
    label: null,
  } satisfies Omit<AppointmentPhoto, 'id'>;
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
          appointmentId: body.appointmentId,
          barberId: body.barberId,
          clientCustomerId: body.clientCustomerId,
          clientLabel: body.clientLabel,
          takenByUserId: '',
          takenAtUtcMs: String(body.takenAtUtcMs),
        },
      },
    });
  await getFirestore(app)
    .collection(Collections.AppointmentPhotos)
    .doc(photoId)
    .set(body);
  return photoId;
}

// ── The booking core's projections and the inbox (flip 1) ────────────────

/**
 * `barberBusy/{barberId}__{localDate}` raw, or `null` while it is absent —
 * the busy day the `rebuildBusyOnAppointmentChange` trigger projects from
 * the appointments: what the SERVER filed, which no client screen shows
 * as such.
 */
export async function readBarberBusyDay(
  barberId: string,
  localDate: string,
): Promise<Record<string, unknown> | null> {
  const snapshot = await getFirestore(adminApp())
    .collection(Collections.BarberBusy)
    .doc(`${barberId}__${localDate}`)
    .get();
  return snapshot.data() ?? null;
}

/**
 * `scheduleExceptions/{barberId}__{localDate}` raw, or `null` while it is
 * absent — the sanitized public effect a staff block writes.
 */
export async function readScheduleException(
  barberId: string,
  localDate: string,
): Promise<Record<string, unknown> | null> {
  const snapshot = await getFirestore(adminApp())
    .collection(Collections.ScheduleExceptions)
    .doc(`${barberId}__${localDate}`)
    .get();
  return snapshot.data() ?? null;
}

/**
 * Seeds `users/{uid}/notifications/*`: `unread` announcements nobody has
 * opened (`readAtUtcMs: null`) and `read` ones already receipted — the flat
 * `InboxNotification` body (minus its `id`), stamped at the seed's fixed
 * instant. Delivery is the matcher's server plan in the product; the inbox
 * the shell's badge counts is only READ by the web, so the e2e writes it.
 */
export async function seedInbox(
  uid: string,
  counts: { readonly unread: number; readonly read: number },
): Promise<void> {
  const db = getFirestore(adminApp());
  const inbox = db
    .collection(Collections.Users)
    .doc(uid)
    .collection(Subcollections.Notifications);
  const batch = db.batch();
  const total = counts.unread + counts.read;
  for (let index = 0; index < total; index++) {
    const body = {
      sentAtUtcMs: SEEDED_AT_UTC_MS,
      readAtUtcMs: index < counts.unread ? null : SEEDED_AT_UTC_MS,
      ...NotificationPayload.announcement(
        { bg: `Съобщение ${index + 1}`, en: `Announcement ${index + 1}` },
        null,
      ),
    } satisfies Omit<InboxNotification, 'id'>;
    batch.set(inbox.doc(`${uid}-note-${index}`), body);
  }
  await batch.commit();
}
