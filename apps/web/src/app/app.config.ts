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
  CLIENT_STATS_READ_PORTS,
  COUPON_VOUCHER_PORTS,
  CUSTOMER_PORTS,
  FIREBASE_FIRESTORE,
  type FactoryPicker,
  INBOX_PORTS,
  LazyAdapterScope,
  LazyPortLoadError,
  SCHEDULE_EXCEPTION_PORTS,
  SCHEDULING_READ_PORTS,
  WAITLIST_READ_PORTS,
  provideFirebaseApp,
  provideFirebaseAuth,
  provideFirebaseFunctions,
  provideLazyPort,
} from '@creativo/infrastructure/firebase-app';
import { provideI18n } from '@creativo/infrastructure/i18n';
import { fail } from '@creativo/domain/kernel';
import {
  MediaError,
  RepositoryError as PortRepositoryError,
  Result,
} from '@core/primitives';
import type { AppointmentPhotoPorts } from '@core/ports';

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
import {
  REWARD_PROGRESS_READER,
  INVITATION_PORT,
  LOYALTY_ACTIVITY_READER,
  LOYALTY_CATALOG_READER,
  LOYALTY_READER,
  STREAK_DEFINITION_REPOSITORY,
  StreakPublishFailedError,
} from '@creativo/application/engagement';
import {
  PROFILE_PORT,
  CONTACT_CHANGE_PORT,
  AVATAR_UPLOADER,
  AvatarUploadError,
} from '@creativo/application/accounts';
import {
  IMPERSONATION_PORT,
  USER_SEARCH_PORT,
} from '@creativo/application/governance';
import {
  COURSE_REPOSITORY,
  POSITION_REPOSITORY,
  SHOP_EVENT_REPOSITORY,
} from '@creativo/application/programs';
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
import { CryptoIdGenerator, SystemClock } from '@creativo/infrastructure/clock';

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
 * The rhythm rule's port fails in its own vocabulary: `publish` and
 * `withdraw` answer a `PublishStreakDefinitionError`, whose "could not be
 * sent" half wraps a `RepositoryError` — and is one in shape, so the ONE
 * answer is valid for `observe` and `listVersions` too (the per-method check
 * holds it to that; client-card revision 3 §4.4, R3-3).
 */
const rhythmRuleUnavailable = (error: LazyPortLoadError) =>
  fail(
    new StreakPublishFailedError(
      new RepositoryError('The data layer failed to load', error),
    ),
  );

/**
 * The same answer for a factory-form row over an ECS bundle: the flat
 * `RepositoryError.unavailable()` struct (`REPOSITORY_UNAVAILABLE`) inside
 * the port's `Result` — valid for every member of a bundle whose members all
 * name `RepositoryError`. A store reading the scheduling streams keeps the
 * policy's defaults on it, as on any other failed read.
 */
const ecsDataUnavailable = () => Result.err(PortRepositoryError.unavailable());

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
const APPOINTMENT_PHOTO_DOCUMENTS = new InjectionToken<
  Omit<AppointmentPhotoPorts, 'uploadPhotoBytes'>
>('APPOINTMENT_PHOTO_PORTS · documents');
const APPOINTMENT_PHOTO_BYTES = new InjectionToken<
  Pick<AppointmentPhotoPorts, 'uploadPhotoBytes'>
>('APPOINTMENT_PHOTO_PORTS · bytes');

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

    // The flip-2/3/4 adapters: classes, bound with the class form until
    // their flips move them.
    // The staff client card (client-card-redesign §6.2): a person's loyalty
    // with the catalogue it is read against.
    provideLazyPort(LOYALTY_READER, firebaseData, {
      adapter: (m) => m.firestore.FirestoreLoyaltyReader,
      methods: {
        getAccount: 'promise',
        listBadgeProgress: 'promise',
        listSeasonProgress: 'promise',
        listLedgerTail: 'promise',
      },
      onLoadError: dataUnavailable,
    }),
    provideLazyPort(LOYALTY_CATALOG_READER, firebaseData, {
      adapter: (m) => m.firestore.FirestoreLoyaltyCatalogReader,
      methods: { getCatalog: 'promise' },
      onLoadError: dataUnavailable,
    }),
    // The rhythm's rule (client-card revision 3 §4.4): the head and its
    // versions, read by the card and by the admin page «Ритъм»; written
    // through the `publishStreakDefinition` callable the adapter calls, which
    // also drops the session's copy of the catalogue once a write lands.
    provideLazyPort(STREAK_DEFINITION_REPOSITORY, firebaseData, {
      adapter: (m) => m.firestore.FirestoreStreakDefinitionRepository,
      methods: {
        observe: 'observable',
        listVersions: 'promise',
        publish: 'promise',
        withdraw: 'promise',
      },
      onLoadError: rhythmRuleUnavailable,
    }),
    // The wallet's loyalty activity by kind, a page at a time (§4.7); its
    // gift vouchers read through `COUPON_VOUCHER_PORTS`.
    provideLazyPort(LOYALTY_ACTIVITY_READER, firebaseData, {
      adapter: (m) => m.firestore.FirestoreLoyaltyActivityReader,
      methods: { page: 'promise' },
      onLoadError: dataUnavailable,
    }),
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
    provideLazyPort(INVITATION_PORT, firebaseData, {
      adapter: (m) => m.firestore.FirestoreInvitationAdapter,
      methods: {
        save: 'promise',
        findById: 'promise',
        saveRedemption: 'promise',
      },
      onLoadError: dataUnavailable,
    }),
    provideLazyPort(PROFILE_PORT, firebaseData, {
      adapter: (m) => m.firestore.FirestoreProfileAdapter,
      methods: {
        getProfile: 'promise',
        observeProfile: 'observable',
        saveProfile: 'promise',
      },
      onLoadError: dataUnavailable,
    }),
    provideLazyPort(AVATAR_UPLOADER, firebaseData, {
      adapter: (m) => m.storage.FirebaseStorageAvatarUploader,
      methods: { upload: 'promise', find: 'promise', remove: 'promise' },
      onLoadError: avatarStorageUnavailable,
    }),
    provideLazyPort(IMPERSONATION_PORT, firebaseData, {
      adapter: (m) => m.firestore.FirestoreImpersonationAdapter,
      methods: {
        save: 'promise',
        findById: 'promise',
        findActiveForAdmin: 'promise',
      },
      onLoadError: dataUnavailable,
    }),
    provideLazyPort(USER_SEARCH_PORT, firebaseData, {
      adapter: (m) => m.firestore.FirestoreUserSearchAdapter,
      methods: { search: 'promise' },
      onLoadError: dataUnavailable,
    }),
    provideLazyPort(POSITION_REPOSITORY, firebaseData, {
      adapter: (m) => m.firestore.FirestorePositionRepository,
      methods: {
        findById: 'promise',
        save: 'promise',
        observeOpen: 'observable',
        observeAll: 'observable',
      },
      onLoadError: dataUnavailable,
    }),
    provideLazyPort(COURSE_REPOSITORY, firebaseData, {
      adapter: (m) => m.firestore.FirestoreCourseRepository,
      methods: {
        findById: 'promise',
        save: 'promise',
        observeOpenAndUpcoming: 'observable',
        observeAll: 'observable',
      },
      onLoadError: dataUnavailable,
    }),
    provideLazyPort(SHOP_EVENT_REPOSITORY, firebaseData, {
      adapter: (m) => m.firestore.FirestoreEventRepository,
      methods: {
        findById: 'promise',
        save: 'promise',
        observeUpcoming: 'observable',
        observePast: 'observable',
      },
      onLoadError: dataUnavailable,
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
