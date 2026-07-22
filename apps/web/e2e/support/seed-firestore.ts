import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const PROJECT_ID = 'demo-creativo-test';

// Must be set before the Admin SDK's Firestore client is first constructed —
// mirrors `mint-custom-token.ts`'s `FIREBASE_AUTH_EMULATOR_HOST` handling for
// the Auth emulator; same port as `firebase.json`'s `emulators.firestore`.
process.env['FIRESTORE_EMULATOR_HOST'] ??= '127.0.0.1:8080';

function adminApp() {
  return (
    getApps().find((candidate) => candidate.name === '[DEFAULT]') ??
    initializeApp({ projectId: PROJECT_ID })
  );
}

/** `HH:mm:ss` + 30 minutes, plain string arithmetic (no `Date`/luxon — those
 * are off-limits outside `libs/domain/kernel`/`libs/infrastructure`, see
 * `docs/architecture/module-boundaries.md`); ignores day rollover, fine for
 * fixture start times picked well clear of midnight. */
function plus30Minutes(iso: string): string {
  const [datePart = '', timePart = '00:00:00'] = iso.split('T');
  const [h = 0, m = 0, s = 0] = timePart.split(':').map(Number);
  let hours = h;
  let minutes = m + 30;
  if (minutes >= 60) {
    minutes -= 60;
    hours += 1;
  }
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${datePart}T${pad(hours)}:${pad(minutes)}:${pad(s)}`;
}

/**
 * Rewrites a naive `YYYY-MM-DDTHH:mm:ss` local wall-clock string into the
 * canonical offset-suffixed form `FirestoreAppointmentRepository`'s
 * `toPersistence` always produces (`ZonedDateTime#toISO()`, Luxon under the
 * hood: `.SSS±HH:MM`). Seeding a doc that doesn't already look like a real
 * `toPersistence` write matters here specifically: `firestore.rules`'
 * client-cancel rule requires `affectedKeys().hasOnly(['status'])`, and a
 * full-aggregate `setDoc` re-serializes `timeSlot` on every save — if the
 * seed's `startIso`/`endIso` differ from what a genuine round-trip through
 * the repository would write, cancelling flags `timeSlot` as "affected"
 * too and the security rule rejects the write. Uses `Intl` (not `Date`/
 * luxon) to look up the zone's UTC offset — safe for fixture times picked
 * well clear of a DST transition, same caveat as `plus30Minutes`.
 */
function toCanonicalIso(localIso: string, zone: string): string {
  const [datePart = '', timePart = '00:00:00'] = localIso.split('T');
  const [year = 1970, month = 1, day = 1] = datePart.split('-').map(Number);
  const [hour = 0, minute = 0, second = 0] = timePart.split(':').map(Number);
  const asIfUtc = new Date(
    Date.UTC(year, month - 1, day, hour, minute, second),
  );
  const offsetPart = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    timeZoneName: 'longOffset',
  })
    .formatToParts(asIfUtc)
    .find((part) => part.type === 'timeZoneName')?.value;
  const offset = offsetPart?.replace('GMT', '') || '+00:00';
  return `${datePart}T${timePart}.000${offset}`;
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

/**
 * Seeds an `appointments/{id}` doc for `ownerUserId` — matches
 * `FirestoreAppointmentRepository`'s persisted shape
 * (`libs/infrastructure/firestore/src/lib/appointment-repository.adapter.ts`).
 */
export async function seedUpcomingAppointment(
  id: string,
  ownerUserId: string,
  startIso: string,
): Promise<void> {
  await getFirestore(adminApp())
    .collection('appointments')
    .doc(id)
    .set({
      barberId: 'e2e-barber',
      locationId: 'e2e-location',
      ownerUserId,
      timeSlot: {
        startIso: toCanonicalIso(startIso, 'Europe/Sofia'),
        endIso: toCanonicalIso(plus30Minutes(startIso), 'Europe/Sofia'),
        zone: 'Europe/Sofia',
      },
      seats: [
        {
          id: 'seat-1',
          serviceId: 'e2e-service',
          subject: {
            kind: 'account',
            userId: ownerUserId,
            relationship: 'self',
          },
        },
      ],
      status: { kind: 'confirmed' },
    });
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
