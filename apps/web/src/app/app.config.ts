import { DOCUMENT } from '@angular/common';
import { provideHttpClient } from '@angular/common/http';
import {
  ApplicationConfig,
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
  FIREBASE_FIRESTORE,
  LazyAdapterScope,
  LazyPortLoadError,
  provideFirebaseApp,
  provideFirebaseAuth,
  provideFirebaseFunctions,
  provideLazyPort,
} from '@creativo/infrastructure/firebase-app';
import { provideI18n } from '@creativo/infrastructure/i18n';
import { fail } from '@creativo/domain/kernel';
import { BookingPolicy } from '@creativo/domain/scheduling';

// Ports (application layer)
import {
  AUTH_DEPLOYMENT,
  AUTH_GATEWAY,
  DEFAULT_AUTH_DEPLOYMENT,
  OTP_CLIENT,
} from '@creativo/application/identity';
import {
  APPOINTMENT_NOTES,
  APPOINTMENT_PHOTOS,
  APPOINTMENT_REPOSITORY,
  AVAILABILITY_READER,
  SCHEDULE_EXCEPTION_WRITER,
  BOOKING_DRAFT_STORE,
  BOOKING_GATEWAY,
  BOOKING_POLICY_READER,
  CLIENT_HISTORY_READER,
  CLIENT_PHOTOS_READER,
  CLIENT_STATS_DIRECTORY,
  CLIENT_STATS_READER,
  WAITLIST_GATEWAY,
  WAITLIST_READER,
} from '@creativo/application/booking';
import { CATALOG_READER, MEDIA_READER } from '@creativo/application/catalog';
import { NOTIFICATION_READER } from '@creativo/application/notifications';
import {
  CLIENT_VOUCHERS_READER,
  COUPON_GRANT_REPOSITORY,
  COUPON_READER,
  GIFT_VOUCHER_READER,
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
    provideLazyPort(APPOINTMENT_REPOSITORY, firebaseData, {
      adapter: (m) => m.firestore.FirestoreAppointmentRepository,
      methods: {
        findById: 'promise',
        save: 'promise',
        observeUpcomingFor: 'observable',
        observeHistoryFor: 'observable',
        observeBarberDay: 'observable',
        searchWindow: 'promise',
      },
      onLoadError: dataUnavailable,
    }),
    provideLazyPort(APPOINTMENT_NOTES, firebaseData, {
      adapter: (m) => m.firestore.FirestoreAppointmentNotes,
      methods: { observe: 'observable', save: 'promise' },
      onLoadError: dataUnavailable,
    }),
    provideLazyPort(APPOINTMENT_PHOTOS, firebaseData, {
      adapter: (m) => m.storage.FirebaseAppointmentPhotos,
      methods: {
        observe: 'observable',
        attach: 'promise',
        adopt: 'promise',
        remove: 'promise',
      },
      onLoadError: dataUnavailable,
    }),
    provideLazyPort(CATALOG_READER, firebaseData, {
      adapter: (m) => m.firestore.FirestoreCatalogReader,
      methods: {
        listActiveServices: 'observable',
        findServiceById: 'promise',
        listServiceCategories: 'observable',
        listActiveBarbers: 'observable',
        findBarberById: 'promise',
        listActiveLocations: 'observable',
        findLocationById: 'promise',
      },
      onLoadError: dataUnavailable,
    }),
    provideLazyPort(AVAILABILITY_READER, firebaseData, {
      adapter: (m) => m.firestore.FirestoreAvailabilityReader,
      methods: { observeDay: 'observable', observeRangeCapacity: 'observable' },
      onLoadError: dataUnavailable,
    }),
    provideLazyPort(SCHEDULE_EXCEPTION_WRITER, firebaseData, {
      adapter: (m) => m.firestore.FirestoreScheduleExceptionWriter,
      methods: {
        put: 'promise',
        putRange: 'promise',
        putSeries: 'promise',
        clearRange: 'promise',
        clear: 'promise',
      },
      onLoadError: dataUnavailable,
    }),
    provideLazyPort(WAITLIST_READER, firebaseData, {
      adapter: (m) => m.firestore.FirestoreWaitlistReader,
      methods: { observeMine: 'observable', findMine: 'promise' },
      onLoadError: dataUnavailable,
    }),
    // The one port without a `Result`: every failure lands on the defaults
    // (see the adapter), so a failed load does too.
    provideLazyPort(BOOKING_POLICY_READER, firebaseData, {
      adapter: (m) => m.firestore.FirestoreBookingPolicyReader,
      methods: { observe: 'observable' },
      onLoadError: () => BookingPolicy.default(),
    }),
    provideLazyPort(CLIENT_STATS_READER, firebaseData, {
      adapter: (m) => m.firestore.FirestoreClientStatsReader,
      methods: { get: 'promise', getMoney: 'promise' },
      onLoadError: dataUnavailable,
    }),
    // The admin page's preview of a rhythm rule walks every client's
    // statistics, a page at a time (client-card revision 3 §4.4); the spend
    // is never read.
    provideLazyPort(CLIENT_STATS_DIRECTORY, firebaseData, {
      adapter: (m) => m.firestore.FirestoreClientStatsDirectory,
      methods: { page: 'promise' },
      onLoadError: dataUnavailable,
    }),
    // The staff client card (client-card-redesign §6.2): a person's visits
    // as company too, their past cuts, and their loyalty with the catalogue
    // it is read against.
    provideLazyPort(CLIENT_HISTORY_READER, firebaseData, {
      adapter: (m) => m.firestore.FirestoreClientHistoryReader,
      methods: { pageForSubject: 'promise' },
      onLoadError: dataUnavailable,
    }),
    provideLazyPort(CLIENT_PHOTOS_READER, firebaseData, {
      adapter: (m) => m.storage.FirebaseClientPhotosReader,
      methods: { listForClient: 'promise', countByAppointment: 'promise' },
      onLoadError: dataUnavailable,
    }),
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
    // The wallet's two feeds (§4.5, §4.7): the gift vouchers issued to a
    // holder, and the loyalty activity by kind, a page at a time.
    provideLazyPort(CLIENT_VOUCHERS_READER, firebaseData, {
      adapter: (m) => m.firestore.FirestoreClientVouchersReader,
      methods: { listForHolder: 'promise' },
      onLoadError: dataUnavailable,
    }),
    provideLazyPort(LOYALTY_ACTIVITY_READER, firebaseData, {
      adapter: (m) => m.firestore.FirestoreLoyaltyActivityReader,
      methods: { page: 'promise' },
      onLoadError: dataUnavailable,
    }),
    // Real now, not the in-memory stub: the waitlist matcher writes a
    // `waitlist_match` notification into the recipient's inbox, and a stub
    // reader meant that write landed in a collection nothing read.
    provideLazyPort(NOTIFICATION_READER, firebaseData, {
      adapter: (m) => m.firestore.FirestoreNotificationReader,
      methods: {
        list: 'observable',
        markRead: 'promise',
        markAllRead: 'promise',
      },
      onLoadError: dataUnavailable,
    }),
    provideLazyPort(MEDIA_READER, firebaseData, {
      adapter: (m) => m.storage.StorageMediaReader,
      methods: { resolve: 'promise' },
      onLoadError: dataUnavailable,
    }),
    provideLazyPort(COUPON_GRANT_REPOSITORY, firebaseData, {
      adapter: (m) => m.firestore.FirestoreCouponGrantRepository,
      methods: {
        save: 'promise',
        findById: 'promise',
        findUsableForUser: 'promise',
      },
      onLoadError: dataUnavailable,
    }),
    // The counter's code lookup — what a typed promo code opens.
    provideLazyPort(COUPON_READER, firebaseData, {
      adapter: (m) => m.firestore.FirestoreCouponReader,
      methods: { findByCode: 'promise', listOpen: 'promise' },
      onLoadError: dataUnavailable,
    }),
    provideLazyPort(GIFT_VOUCHER_READER, firebaseData, {
      adapter: (m) => m.firestore.FirestoreGiftVoucherReader,
      methods: { findByCode: 'promise' },
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
