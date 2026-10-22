import { DOCUMENT } from '@angular/common';
import { provideHttpClient } from '@angular/common/http';
import {
  ApplicationConfig,
  InjectionToken,
  inject,
  isDevMode,
  provideBrowserGlobalErrorListeners,
  provideZonelessChangeDetection,
} from '@angular/core';
import {
  ActivatedRouteSnapshot,
  provideRouter,
  withComponentInputBinding,
  withViewTransitions,
} from '@angular/router';
import { provideServiceWorker } from '@angular/service-worker';

import {
  APPOINTMENT_NOTE_PORTS,
  APPOINTMENT_PHOTO_PORTS,
  APPOINTMENT_READ_PORTS,
  CATALOG_PORTS,
  CLIENT_JOURNAL_PORTS,
  CLIENT_STATS_READ_PORTS,
  CLOCK_PORTS,
  COUPON_VOUCHER_PORTS,
  COURSE_READ_PORTS,
  CUSTOMER_PORTS,
  DEFAULT_LOCATION_PORTS,
  FIREBASE_FIRESTORE,
  FIREBASE_FUNCTIONS,
  type FactoryPicker,
  ID_PORTS,
  IMPERSONATION_READ_PORTS,
  INBOX_PORTS,
  LOCATION_LOAD_PORTS,
  LOYALTY_ACCOUNT_READ_PORTS,
  LOYALTY_CATALOG_MEMO,
  LOYALTY_CATALOG_READ_PORTS,
  LazyAdapterScope,
  LazyPortLoadError,
  POSITION_READ_PORTS,
  PROFILE_PORTS,
  PROGRAMS_PORTS,
  SCHEDULE_EXCEPTION_PORTS,
  SCHEDULING_READ_PORTS,
  SHOP_EVENT_READ_PORTS,
  STREAK_DEFINITION_PORTS,
  STREAK_PUBLISH_PORTS,
  USER_SEARCH_PORTS,
  WAITLIST_READ_PORTS,
  provideFirebaseApp,
  provideFirebaseAuth,
  provideFirebaseFunctions,
  provideLazyPort,
} from '@creativo/infrastructure/firebase-app';
import { provideI18n } from '@creativo/infrastructure/i18n';
import { fail } from '@creativo/domain/kernel';
import {
  type LocalDate,
  MediaError,
  RepositoryError as PortRepositoryError,
  Result,
  UtcEpochMs,
} from '@core/primitives';
import { TenantConfig } from '@core/components';
import { ZonedTimeSystem } from '@core/systems';
import type {
  AppointmentPhotoPorts,
  AppointmentPhotoRecordPorts,
  DefaultLocationPorts,
  PhotoUploadPorts,
} from '@core/ports';

// Ports (application layer)
import {
  AUTH_DEPLOYMENT,
  AUTH_GATEWAY,
  DEFAULT_AUTH_DEPLOYMENT,
  OTP_CLIENT,
} from '@creativo/application/identity';
import {
  BOOKING_DRAFT_STORE,
  BOOKING_GATEWAY,
  WAITLIST_GATEWAY,
} from '@creativo/application/booking';
import { MEDIA_READER } from '@creativo/application/catalog';
import { REWARD_PROGRESS_READER } from '@creativo/application/engagement';
import {
  CONTACT_CHANGE_PORT,
  AVATAR_UPLOADER,
  AvatarUploadError,
} from '@creativo/application/accounts';
import {
  CLOCK,
  ID_GENERATOR,
  KEY_VALUE_STORE,
  RepositoryError,
  provideFeatureFlags,
} from '@creativo/application/shared';

// Adapters (infrastructure layer) — named ONLY here (blueprint §1.3)
import {
  FirebaseAuthGateway,
  CallableOtpClient,
} from '@creativo/infrastructure/firebase-auth';
// The callables are eager (firebase/functions loads at boot anyway); every
// Firestore and Storage adapter is picked out of the lazy modules below.
import {
  CallableBookingGateway,
  CallableContactChangeAdapter,
  CallableWaitlistGateway,
  loadFirestoreAdapters,
} from '@creativo/infrastructure/firestore';
import { loadStorageAdapters } from '@creativo/infrastructure/storage';
import {
  LocalStorageKeyValueStore,
  SessionStorageDraftStore,
} from '@creativo/infrastructure/web-storage';
import {
  CryptoIdGenerator,
  SystemClock,
  browserClockPorts,
  browserIdPorts,
} from '@creativo/infrastructure/clock';

import { appRoutes } from './app.routes';
import { environment } from '../environments/environment';

const emulators = environment.emulators.enabled
  ? environment.emulators
  : undefined;

/**
 * THE DATA LAYER LOADS ON ITS FIRST CALL, NOT AT BOOT.
 *
 * The Firestore and Storage SDKs, their two instances (same emulator wiring
 * and persistent cache as ever) and every adapter over them are fetched as
 * two parallel chunks on the first call of any port bound to this scope;
 * the instances then live in ONE environment injector under the root, each
 * adapter in its own injector beneath it — one scope, not two, because the
 * visit photos adapter needs both instances. The two SDKs
 * (with re2js and webchannel-wrapper) were 565 kB of a 1.55 MB initial
 * chunk; it is ~955 kB without them (2026-09-26). Auth and Functions stay
 * eager because the session needs them at boot.
 *
 * `node tools/verify/bundle/check-initial-bundle.mjs` (over the stats.json
 * of `nx build web -- --stats-json`) proves neither SDK is back in the
 * initial chunk; the `initial` budget in project.json fails a build past
 * 1 MB. The mechanism: `provideLazyPort` in
 * `@creativo/infrastructure/firebase-app` (lazy-port.ts); `app.config.spec.ts`
 * proves that injecting every port bound here loads nothing.
 *
 * Both instances are created as the scope loads (`instances`): an SDK that
 * throws while being created fails the LOAD, which the next call retries
 * from scratch. Firestore goes LAST, so a retry re-runs `initializeFirestore`
 * only when Firestore's own factory threw — a second call after one that
 * succeeded throws `failed-precondition` (the persistent-cache settings
 * never compare equal), where `getStorage` just returns its instance.
 */
export const firebaseData = new LazyAdapterScope('firebase-data', async () => {
  const [firestore, storage] = await Promise.all([
    loadFirestoreAdapters(),
    loadStorageAdapters(),
  ]);
  return {
    module: { firestore, storage },
    providers: [
      firestore.provideFirestoreDb(emulators),
      storage.provideFirebaseStorage(emulators),
    ],
    instances: [storage.FIREBASE_STORAGE, FIREBASE_FIRESTORE],
  };
});

/**
 * A data port whose chunk failed to load answers as its adapter answers any
 * other transient failure — a `RepositoryError` inside the port's `Result`
 * (`MediaReadError` counts it as transient too) — never as a rejection.
 *
 * Typed consts, not inline arrows: inside `onLoadError: (e) => fail(…)` the
 * call's success type is inferred from the binding's own type parameter
 * (`Result<unknown, E>`), which the per-method check rightly refuses.
 */
const dataUnavailable = (error: LazyPortLoadError) =>
  fail(new RepositoryError('The data layer failed to load', error));

/** The avatar port's own failure shape, for the same reason. */
const avatarStorageUnavailable = (error: LazyPortLoadError) =>
  fail(new AvatarUploadError('Storage failed to load', error));

/**
 * The same answer for a factory-form row over an ECS bundle: the flat
 * `RepositoryError.unavailable()` struct (`REPOSITORY_UNAVAILABLE`) inside
 * the port's `Result` — valid for every member of a bundle whose members all
 * name `RepositoryError`. A store reading the scheduling streams keeps the
 * policy's defaults on it, as on any other failed read; the admin rhythm
 * page words it on a publish as the rule that could not be sent.
 */
const ecsDataUnavailable = () => Result.err(PortRepositoryError.unavailable());

/** The shop's zone the loyalty catalogue's day is read in — today's loyalty zone. */
const LOYALTY_SHOP_ZONE = 'Europe/Sofia';

/**
 * The shop's day NOW, read on every call (`Date.now()` in the shop's zone):
 * the key of the session's catalogue memo (flip-3 plan F3-10), so a tab
 * left open past the shop's midnight reads the catalogue again. The one
 * clock-and-zone reading of the loyalty rows — the adapter that keys by it
 * holds none. Read on the first catalogue call, never at boot.
 */
const loyaltyCatalogToday = (): LocalDate => {
  const zone = ZonedTimeSystem.checkZone(LOYALTY_SHOP_ZONE);
  const now = UtcEpochMs.of(Date.now());
  if (!zone.ok || !now.ok) {
    throw new Error('unreachable: an IANA zone and a safe-integer clock');
  }
  return ZonedTimeSystem.toLocal(now.value, zone.value).localDate;
};

/** What `firebaseData` loads: the Firestore and the Storage adapter modules. */
type FirebaseDataModule =
  typeof firebaseData extends LazyAdapterScope<infer M> ? M : never;

/**
 * The visit photos' ONE bundle, over both instances: the documents
 * (Firestore) and their bytes (Storage). Its two rows below name this one
 * factory, so the scope builds the bundle once and both halves call into it.
 */
const appointmentPhotoBundle: FactoryPicker<
  FirebaseDataModule,
  AppointmentPhotoPorts
> = (m) => (inj) =>
  m.storage.appointmentPhotoPorts(
    inj.get(FIREBASE_FIRESTORE),
    inj.get(m.storage.FIREBASE_STORAGE),
  );

/**
 * The photo bundle speaks TWO failure vocabularies — its documents answer
 * `RepositoryError`, its bytes (`uploadPhotoBytes`) `MediaError` — and a
 * binding's ONE load-failure answer must be valid for every member it
 * classifies. No value is both, so the bundle is bound as two halves over
 * the one factory, each failing in its own words, and
 * `APPOINTMENT_PHOTO_PORTS` is the two put back together. These tokens are
 * this file's alone; features inject `APPOINTMENT_PHOTO_PORTS`.
 */
const APPOINTMENT_PHOTO_DOCUMENTS =
  new InjectionToken<AppointmentPhotoRecordPorts>(
    'APPOINTMENT_PHOTO_PORTS · documents',
  );
const APPOINTMENT_PHOTO_BYTES = new InjectionToken<PhotoUploadPorts>(
  'APPOINTMENT_PHOTO_PORTS · bytes',
);

/**
 * The bytes' half failing to load: Storage's transient answer for the
 * visit-photo folder — worth a bounded retry, as a failed chunk fetch is.
 */
const photoBytesUnavailable = () =>
  Result.err(MediaError.transient('appointmentPhotos'));

/**
 * The path a snapshot resolves to, WITHOUT its query parameters.
 *
 * Comparing `routeConfig` identity would be cheaper and is the obvious first
 * reach, but it is too blunt: two genuinely different URLs share one config
 * whenever a route is parameterised (`/visit/1` -> `/visit/2`), and those are
 * real navigations that should still animate. Comparing the resolved path
 * skips exactly the case that is not a navigation at all — the same screen,
 * re-published with a different query string.
 */
export function pathOf(snapshot: ActivatedRouteSnapshot): string {
  return snapshot.pathFromRoot
    .flatMap((route) => route.url)
    .map((segment) => segment.path)
    .join('/');
}

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZonelessChangeDetection(),
    provideHttpClient(),
    ...provideI18n(),
    provideRouter(
      appRoutes,
      withComponentInputBinding(),
      withViewTransitions({
        onViewTransitionCreated: ({ transition, from, to }) => {
          const document = inject(DOCUMENT);
          const prefersReducedMotion = document.defaultView?.matchMedia(
            '(prefers-reduced-motion: reduce)',
          ).matches;
          // A QUERY-PARAM SYNC IS NOT A PAGE CHANGE.
          //
          // The staff day store mirrors the shown day into `?day=` through
          // `router.navigate`, so every tap on the week strip was a real
          // navigation — and the router handed it to
          // `document.startViewTransition()`, which cross-dissolved the whole
          // document. Measured across four independent instruments: the
          // screen was a double exposure of two different days for ~400ms
          // after each tap, and pixels stopped changing a median 378ms in
          // against 30ms with this skip. It also swallowed the week strip's
          // own 150ms disc slide whole — that animation ran underneath a
          // snapshot layer between 0% and 2% opaque, which is why two rounds
          // of tuning the disc's curve changed nothing anyone could see
          // (measured difference between the old curve and the new one, on
          // screen: 1.5ms).
          if (prefersReducedMotion || pathOf(from) === pathOf(to)) {
            transition.skipTransition();
          }
        },
      }),
    ),
    provideServiceWorker('ngsw-worker.js', {
      enabled: !isDevMode(),
      registrationStrategy: 'registerWhenStable:30000',
    }),

    // Firebase SDK singletons (raw SDK stays behind these tokens). Only the
    // eager ones: Firestore and Storage are created inside `firebaseData`.
    provideFirebaseApp(environment.firebase),
    provideFirebaseAuth(emulators),
    provideFirebaseFunctions(emulators),

    // ── Deployment config ──
    // Explicit even though the token has a matching factory default: this
    // is THE per-deployment override point (auth strategy, entry
    // providers, default phone country) and it stays visible in the wiring.
    { provide: AUTH_DEPLOYMENT, useValue: DEFAULT_AUTH_DEPLOYMENT },
    // Build-time flags from config/feature-flags.json (R41); a bad map
    // throws here, so the app refuses to boot rather than hide a feature.
    provideFeatureFlags(environment.featureFlags),

    // ── Port → Adapter map (the hexagon's outer wiring, blueprint §1.3) ──
    { provide: CLOCK, useClass: SystemClock },
    { provide: ID_GENERATOR, useClass: CryptoIdGenerator },
    // The same two as ECS bundles (flip 4, F4-9): what the flipped features
    // read "now" and draw ids through; the two above stay for the features
    // that still inject `CLOCK`/`ID_GENERATOR` until Phase 4.
    { provide: CLOCK_PORTS, useFactory: browserClockPorts },
    { provide: ID_PORTS, useFactory: browserIdPorts },
    // The deployment's main shop — configuration, not a read (F-4): an event
    // with no location of its own is placed on this shop's clock. The one
    // place the web names it, as `main.ts` names `tenantTimeZone`.
    {
      provide: DEFAULT_LOCATION_PORTS,
      useValue: {
        defaultLocationId: TenantConfig.DEFAULT.defaultLocationId,
      } satisfies DefaultLocationPorts,
    },
    { provide: AUTH_GATEWAY, useClass: FirebaseAuthGateway },
    { provide: OTP_CLIENT, useClass: CallableOtpClient },
    { provide: BOOKING_GATEWAY, useClass: CallableBookingGateway },
    { provide: WAITLIST_GATEWAY, useClass: CallableWaitlistGateway },
    { provide: CONTACT_CHANGE_PORT, useClass: CallableContactChangeAdapter },
    { provide: BOOKING_DRAFT_STORE, useClass: SessionStorageDraftStore },
    { provide: KEY_VALUE_STORE, useClass: LocalStorageKeyValueStore },

    // ── Lazy ports: Firestore and Storage adapters (see `firebaseData`) ──
    // Each binding classifies every method of its port; the compiler
    // refuses a missing one, a wrong kind, a synchronous method, or an
    // `onLoadError` answer that is not valid for every method.

    // The booking core (flip 1): plain port BUNDLES, each built once per
    // scope by its `(db) => bundle` export — the factory form.
    provideLazyPort(SCHEDULING_READ_PORTS, firebaseData, {
      factory: (m) => (inj) =>
        m.firestore.schedulingReadPorts(inj.get(FIREBASE_FIRESTORE)),
      methods: {
        observeBusyDay: 'observable',
        observeExceptions: 'observable',
        observeSchedule: 'observable',
        observeLocation: 'observable',
        observePolicy: 'observable',
        observeCapacityMonth: 'observable',
      },
      onLoadError: ecsDataUnavailable,
    }),
    provideLazyPort(SCHEDULE_EXCEPTION_PORTS, firebaseData, {
      factory: (m) => (inj) =>
        m.firestore.scheduleExceptionPorts(inj.get(FIREBASE_FIRESTORE)),
      methods: { writeScheduleException: 'promise' },
      onLoadError: ecsDataUnavailable,
    }),
    provideLazyPort(APPOINTMENT_READ_PORTS, firebaseData, {
      factory: (m) => (inj) =>
        m.firestore.appointmentReadPorts(inj.get(FIREBASE_FIRESTORE)),
      methods: {
        observeAppointment: 'observable',
        observeBarberDay: 'observable',
        observeUpcoming: 'observable',
        observeHistory: 'observable',
        pageClientHistory: 'promise',
        searchAppointmentWindow: 'promise',
      },
      onLoadError: ecsDataUnavailable,
    }),
    provideLazyPort(WAITLIST_READ_PORTS, firebaseData, {
      factory: (m) => (inj) =>
        m.firestore.waitlistReadPorts(inj.get(FIREBASE_FIRESTORE)),
      methods: { observeMyWaitlistRequests: 'observable' },
      onLoadError: ecsDataUnavailable,
    }),
    // The staff client card (client-card-redesign §6.2) and the admin page's
    // preview of a rhythm rule, which walks every client's statistics a page
    // at a time (client-card revision 3 §4.4); the spend is read on its own.
    provideLazyPort(CLIENT_STATS_READ_PORTS, firebaseData, {
      factory: (m) => (inj) =>
        m.firestore.clientStatsReadPorts(inj.get(FIREBASE_FIRESTORE)),
      methods: {
        loadClientStats: 'promise',
        loadClientMoney: 'promise',
        pageClientStats: 'promise',
      },
      onLoadError: ecsDataUnavailable,
    }),
    provideLazyPort(CATALOG_PORTS, firebaseData, {
      factory: (m) => (inj) =>
        m.firestore.catalogReadPorts(inj.get(FIREBASE_FIRESTORE)),
      methods: {
        observeServices: 'observable',
        observeBarbers: 'observable',
        observeCategories: 'observable',
        observeLocations: 'observable',
      },
      onLoadError: ecsDataUnavailable,
    }),
    // The counter's code lookups (what a typed promo code opens), a client's
    // held grants and the coupons they name whatever their status, and the
    // wallet's gift vouchers.
    provideLazyPort(COUPON_VOUCHER_PORTS, firebaseData, {
      factory: (m) => (inj) =>
        m.firestore.couponVoucherPorts(inj.get(FIREBASE_FIRESTORE)),
      methods: {
        findCouponByCode: 'promise',
        listOpenCoupons: 'promise',
        loadCouponGrant: 'promise',
        listUsableCouponGrants: 'promise',
        findGiftVoucherByCode: 'promise',
        listGiftVouchersForHolder: 'promise',
        loadCoupons: 'promise',
      },
      onLoadError: ecsDataUnavailable,
    }),
    // The waitlist matcher writes a match into the recipient's inbox; the
    // menu's unread count reads it live.
    provideLazyPort(INBOX_PORTS, firebaseData, {
      factory: (m) => (inj) =>
        m.firestore.inboxPorts(inj.get(FIREBASE_FIRESTORE)),
      methods: {
        observeInbox: 'observable',
        markNotificationRead: 'promise',
        markAllNotificationsRead: 'promise',
      },
      onLoadError: ecsDataUnavailable,
    }),
    provideLazyPort(APPOINTMENT_NOTE_PORTS, firebaseData, {
      factory: (m) => (inj) =>
        m.firestore.appointmentNotePorts(inj.get(FIREBASE_FIRESTORE)),
      methods: {
        observeAppointmentNote: 'observable',
        saveAppointmentNote: 'promise',
      },
      onLoadError: ecsDataUnavailable,
    }),
    // The one bundle over both instances (`appointmentPhotoBundle`), bound
    // as its two halves and handed to features whole.
    provideLazyPort(APPOINTMENT_PHOTO_DOCUMENTS, firebaseData, {
      factory: appointmentPhotoBundle,
      methods: {
        observeAppointmentPhotos: 'observable',
        saveAppointmentPhoto: 'promise',
        deleteAppointmentPhoto: 'promise',
        listClientPhotos: 'promise',
        countPhotosByAppointment: 'promise',
      },
      onLoadError: ecsDataUnavailable,
    }),
    provideLazyPort(APPOINTMENT_PHOTO_BYTES, firebaseData, {
      factory: appointmentPhotoBundle,
      methods: { uploadPhotoBytes: 'promise' },
      onLoadError: photoBytesUnavailable,
    }),
    {
      provide: APPOINTMENT_PHOTO_PORTS,
      useFactory: (): AppointmentPhotoPorts => ({
        ...inject(APPOINTMENT_PHOTO_DOCUMENTS),
        ...inject(APPOINTMENT_PHOTO_BYTES),
      }),
    },
    provideLazyPort(CUSTOMER_PORTS, firebaseData, {
      factory: (m) => (inj) =>
        m.firestore.customerPorts(inj.get(FIREBASE_FIRESTORE)),
      methods: { loadCustomerForUser: 'promise' },
      onLoadError: ecsDataUnavailable,
    }),

    // Identity and accounts (flip 2): an account's own profile — the stored
    // `users/{uid}` body, live and once, and the owner's edit of its five
    // allowlisted keys in one transaction — the staff client search over
    // index #8, and an admin's live impersonation session (index #9).
    provideLazyPort(PROFILE_PORTS, firebaseData, {
      factory: (m) => (inj) =>
        m.firestore.profilePorts(inj.get(FIREBASE_FIRESTORE)),
      methods: {
        observeProfile: 'observable',
        loadProfile: 'promise',
        writeOwnProfile: 'promise',
      },
      onLoadError: ecsDataUnavailable,
    }),
    provideLazyPort(USER_SEARCH_PORTS, firebaseData, {
      factory: (m) => (inj) =>
        m.firestore.userSearchPorts(inj.get(FIREBASE_FIRESTORE)),
      methods: { searchUsers: 'promise' },
      onLoadError: ecsDataUnavailable,
    }),
    provideLazyPort(IMPERSONATION_READ_PORTS, firebaseData, {
      factory: (m) => (inj) =>
        m.firestore.impersonationReadPorts(inj.get(FIREBASE_FIRESTORE)),
      methods: { observeActiveImpersonation: 'observable' },
      onLoadError: ecsDataUnavailable,
    }),

    // Loyalty and the rhythm's rule (flip 3): a client RECORD's account,
    // badge and season progress and its journal pages (the staff client
    // card, client-card-redesign §6.2, revision 3 §4.7); the published
    // catalogue with the rhythm's heads, memoised for the session and the
    // shop's day in the root `LOYALTY_CATALOG_MEMO`; the head, live, and its
    // versions (the card and the admin page «Ритъм»); and the publish
    // callable, which drops that same memo once a write lands (§4.4).
    provideLazyPort(LOYALTY_ACCOUNT_READ_PORTS, firebaseData, {
      factory: (m) => (inj) =>
        m.firestore.loyaltyAccountReadPorts(inj.get(FIREBASE_FIRESTORE)),
      methods: {
        loadLoyaltyAccount: 'promise',
        listBadgeProgress: 'promise',
        listSeasonProgress: 'promise',
      },
      onLoadError: ecsDataUnavailable,
    }),
    provideLazyPort(LOYALTY_CATALOG_READ_PORTS, firebaseData, {
      factory: (m) => (inj) =>
        m.firestore.loyaltyCatalogReadPorts(
          inj.get(FIREBASE_FIRESTORE),
          inj.get(LOYALTY_CATALOG_MEMO),
          loyaltyCatalogToday,
        ),
      methods: { loadLoyaltyCatalog: 'promise' },
      onLoadError: ecsDataUnavailable,
    }),
    provideLazyPort(CLIENT_JOURNAL_PORTS, firebaseData, {
      factory: (m) => (inj) =>
        m.firestore.clientJournalPorts(inj.get(FIREBASE_FIRESTORE)),
      methods: { pageClientJournal: 'promise' },
      onLoadError: ecsDataUnavailable,
    }),
    provideLazyPort(STREAK_DEFINITION_PORTS, firebaseData, {
      factory: (m) => (inj) =>
        m.firestore.streakDefinitionPorts(inj.get(FIREBASE_FIRESTORE)),
      methods: {
        observeStreakDefinitionHead: 'observable',
        listStreakDefinitionVersions: 'promise',
      },
      onLoadError: ecsDataUnavailable,
    }),
    provideLazyPort(STREAK_PUBLISH_PORTS, firebaseData, {
      factory: (m) => (inj) =>
        m.firestore.streakPublishGatewayPorts(
          inj.get(FIREBASE_FUNCTIONS),
          inj.get(LOYALTY_CATALOG_MEMO),
        ),
      methods: { publishStreakRule: 'promise', withdrawStreakRule: 'promise' },
      onLoadError: ecsDataUnavailable,
    }),

    // Programs (flip 4): the careers, courses and events pages' live lists,
    // and the admin page's suite — the three lists unfiltered, each item
    // loaded and saved whole (a rules-guarded admin write, D9(b)) — with the
    // one shop an event save reads its zone from.
    provideLazyPort(PROGRAMS_PORTS, firebaseData, {
      factory: (m) => (inj) =>
        m.firestore.programsPorts(inj.get(FIREBASE_FIRESTORE)),
      methods: {
        observePositions: 'observable',
        loadPosition: 'promise',
        savePosition: 'promise',
        observeCourses: 'observable',
        loadCourse: 'promise',
        saveCourse: 'promise',
        observeEvents: 'observable',
        loadEvent: 'promise',
        saveEvent: 'promise',
      },
      onLoadError: ecsDataUnavailable,
    }),
    provideLazyPort(POSITION_READ_PORTS, firebaseData, {
      factory: (m) => (inj) =>
        m.firestore.positionReadPorts(inj.get(FIREBASE_FIRESTORE)),
      methods: { observePositions: 'observable' },
      onLoadError: ecsDataUnavailable,
    }),
    provideLazyPort(COURSE_READ_PORTS, firebaseData, {
      factory: (m) => (inj) =>
        m.firestore.courseReadPorts(inj.get(FIREBASE_FIRESTORE)),
      methods: { observeCourses: 'observable' },
      onLoadError: ecsDataUnavailable,
    }),
    provideLazyPort(SHOP_EVENT_READ_PORTS, firebaseData, {
      factory: (m) => (inj) =>
        m.firestore.shopEventReadPorts(inj.get(FIREBASE_FIRESTORE)),
      methods: { observeEvents: 'observable' },
      onLoadError: ecsDataUnavailable,
    }),
    provideLazyPort(LOCATION_LOAD_PORTS, firebaseData, {
      factory: (m) => (inj) =>
        m.firestore.locationLoadPorts(inj.get(FIREBASE_FIRESTORE)),
      methods: { loadLocation: 'promise' },
      onLoadError: ecsDataUnavailable,
    }),

    // The class adapters still bound with the class form: the media reader,
    // the dormant reward progress and the avatar uploader.
    provideLazyPort(MEDIA_READER, firebaseData, {
      adapter: (m) => m.storage.StorageMediaReader,
      methods: { resolve: 'promise' },
      onLoadError: dataUnavailable,
    }),
    provideLazyPort(REWARD_PROGRESS_READER, firebaseData, {
      adapter: (m) => m.firestore.FirestoreRewardProgressReader,
      methods: { observeForUser: 'observable' },
      onLoadError: dataUnavailable,
    }),
    provideLazyPort(AVATAR_UPLOADER, firebaseData, {
      adapter: (m) => m.storage.FirebaseStorageAvatarUploader,
      methods: { upload: 'promise', find: 'promise', remove: 'promise' },
      onLoadError: avatarStorageUnavailable,
    }),

    // ── Icons and the logo ──
    // Resolved by @creativo/ui/icons from its bundled manifest. The registry
    // has a seam for a backend-supplied manifest (`provideUiIconManifest`),
    // deliberately NOT wired: this is a web app on Firebase Hosting, a
    // redeploy takes a minute and reaches every user on their next load, so
    // a live override layer would only add a document, a cache and a
    // listener to maintain. See docs/design-research/icon-registry-design.md §6.
  ],
};
