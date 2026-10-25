import { DOCUMENT } from '@angular/common';
import { provideHttpClient } from '@angular/common/http';
import {
  ApplicationConfig,
  ErrorHandler,
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
  AUTH_DEPLOYMENT_PORTS,
  AUTH_SESSION_PORTS,
  AVATAR_PORTS,
  BOOKING_DRAFT_PORTS,
  CATALOG_PORTS,
  CLIENT_JOURNAL_PORTS,
  CLIENT_STATS_READ_PORTS,
  CLOCK_PORTS,
  COUPON_VOUCHER_PORTS,
  COURSE_READ_PORTS,
  CUSTOMER_PORTS,
  DEFAULT_LOCATION_PORTS,
  FIREBASE_AUTH,
  FIREBASE_FIRESTORE,
  FIREBASE_FUNCTIONS,
  type FactoryPicker,
  GATEWAY_PORTS,
  ID_PORTS,
  INBOX_PORTS,
  LOCATION_LOAD_PORTS,
  LOYALTY_ACCOUNT_READ_PORTS,
  LOYALTY_CATALOG_MEMO,
  LOYALTY_CATALOG_READ_PORTS,
  type LazyAdapterScope,
  LazyMethod,
  MEDIA_RESOLVE_PORTS,
  OTP_CHALLENGE_PORTS,
  POSITION_READ_PORTS,
  PROFILE_PORTS,
  PROGRAMS_PORTS,
  SCHEDULE_EXCEPTION_PORTS,
  SCHEDULING_READ_PORTS,
  SHOP_EVENT_READ_PORTS,
  STREAK_DEFINITION_PORTS,
  STREAK_PUBLISH_PORTS,
  TIMER_PORTS,
  USER_SEARCH_PORTS,
  WAITLIST_READ_PORTS,
  callableClientPorts,
  errorHandlerLogPorts,
  lazyAdapterScope,
  provideFirebaseApp,
  provideFirebaseAuth,
  provideFirebaseFunctions,
  provideFlags,
  provideLazyPort,
} from '@creativo/infrastructure/firebase-app';
import { provideI18n } from '@creativo/infrastructure/i18n';
import { Result } from '@core/primitives';
import { MediaError, RepositoryError } from '@core/errors';
import { AuthDeployment, TenantConfig } from '@core/components';
import type {
  AppointmentPhotoPorts,
  AppointmentPhotoRecordPorts,
  AuthDeploymentPorts,
  DefaultLocationPorts,
  PhotoUploadPorts,
} from '@core/ports';

// Adapters (infrastructure layer) — named ONLY here (blueprint §1.3). The
// session, the OTP callables and the callable client are eager
// (firebase/auth and firebase/functions load at boot anyway); every
// Firestore and Storage adapter is picked out of the lazy modules below.
import {
  authSessionPorts,
  otpChallengePorts,
} from '@creativo/infrastructure/firebase-auth';
import { loadFirestoreAdapters } from '@creativo/infrastructure/firestore';
import { loadStorageAdapters } from '@creativo/infrastructure/storage';
import { sessionStorageBookingDraftPorts } from '@creativo/infrastructure/web-storage';
import {
  browserClockPorts,
  browserIdPorts,
  browserTimerPorts,
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
 * bundle built once by its factory in that injector's context — one scope,
 * not two, because the visit photos adapter needs both instances. The two SDKs
 * (with re2js and webchannel-wrapper) were 565 kB of a 1.55 MB initial
 * chunk; it is ~955 kB without them (2026-09-26). Auth and Functions stay
 * eager because the session needs them at boot.
 *
 * `node tools/verify/bundle/check-initial-bundle.mjs` (over the stats.json
 * of `nx build web -- --stats-json`) proves neither SDK is back in the
 * initial chunk; the `initial` budget in project.json fails a build past
 * 1 MB. The mechanism: `lazyAdapterScope` + `provideLazyPort` in
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
export const firebaseData = lazyAdapterScope('firebase-data', async () => {
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
 * other transient failure — never as a rejection: the flat
 * `RepositoryError.unavailable()` struct (`REPOSITORY_UNAVAILABLE`) inside
 * the port's `Result`, valid for every member of a bundle whose members all
 * name `RepositoryError`. A store reading the scheduling streams keeps the
 * policy's defaults on it, as on any other failed read; the admin rhythm
 * page words it on a publish as the rule that could not be sent.
 */
const dataUnavailable = () => Result.err(RepositoryError.unavailable());

/**
 * A Storage port whose chunk failed to load: Storage's transient answer for
 * the folder it serves — worth a bounded retry, as a failed chunk fetch is
 * (never the permanent not-found/forbidden, which would stop the asking).
 */
const avatarsUnavailable = () => Result.err(MediaError.transient('avatars'));
const mediaUnavailable = () => Result.err(MediaError.transient('media'));

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
    {
      provide: AUTH_DEPLOYMENT_PORTS,
      useValue: {
        authDeployment: AuthDeployment.DEFAULT,
      } satisfies AuthDeploymentPorts,
    },
    // Build-time flags from config/feature-flags.json (R41); a bad map
    // throws here, so the app refuses to boot rather than hide a feature.
    provideFlags(environment.featureFlags),

    // ── Port bundle → adapter factory (the outer wiring, blueprint §1.3) ──
    // The browser's clock, ids and timer: what the features read "now",
    // draw ids and wait through (flip 4, F4-9; the timer Phase 4a 4A-7).
    { provide: CLOCK_PORTS, useFactory: browserClockPorts },
    { provide: ID_PORTS, useFactory: browserIdPorts },
    { provide: TIMER_PORTS, useFactory: browserTimerPorts },
    // The deployment's main shop — configuration, not a read (F-4): a
    // boundary with no location of its own reads this shop's zone
    // (`resolveShopZone`, `ShopZoneService`). The one place the web names it.
    {
      provide: DEFAULT_LOCATION_PORTS,
      useValue: {
        defaultLocationId: TenantConfig.DEFAULT.defaultLocationId,
      } satisfies DefaultLocationPorts,
    },
    // The session and the callables, eager: the shell reads the session at
    // boot, and every callable goes through the ONE typed client.
    {
      provide: AUTH_SESSION_PORTS,
      useFactory: () => authSessionPorts(inject(FIREBASE_AUTH)),
    },
    {
      provide: GATEWAY_PORTS,
      useFactory: () => callableClientPorts(inject(FIREBASE_FUNCTIONS)),
    },
    {
      provide: OTP_CHALLENGE_PORTS,
      useFactory: () =>
        otpChallengePorts(
          inject(FIREBASE_AUTH),
          inject(GATEWAY_PORTS),
          inject(DOCUMENT),
        ),
    },
    // The device's storage: the `/book` draft per tab.
    {
      provide: BOOKING_DRAFT_PORTS,
      useFactory: sessionStorageBookingDraftPorts,
    },

    // ── Lazy ports: Firestore and Storage adapters (see `firebaseData`) ──
    // Each binding classifies every method of its port; the compiler
    // refuses a missing one, a wrong kind, a synchronous method, or an
    // `onLoadError` answer that is not valid for every method.

    // The booking core (flip 1): plain port BUNDLES, each built once per
    // scope by its `(db) => bundle` export. The four bundles that read
    // `barberBusy`, `appointments`, `customers` and `appointmentNotes` are
    // built with the read-time guard (edge hardening D-7; the note since
    // pass E, E-2): refusals reported through
    // Angular's ErrorHandler (`errorHandlerLogPorts` — the device console
    // today), the guard made inside this lazy scope so `@core/systems`
    // stays off the initial chunk.
    provideLazyPort(SCHEDULING_READ_PORTS, firebaseData, {
      factory: (m) => (inj) =>
        m.firestore.schedulingReadPorts(
          inj.get(FIREBASE_FIRESTORE),
          m.firestore.guardedReads(errorHandlerLogPorts(inj.get(ErrorHandler))),
        ),
      methods: {
        observeBusyDay: LazyMethod.Observable,
        observeExceptions: LazyMethod.Observable,
        observeSchedule: LazyMethod.Observable,
        observeLocation: LazyMethod.Observable,
        observePolicy: LazyMethod.Observable,
        observeCapacityMonth: LazyMethod.Observable,
      },
      onLoadError: dataUnavailable,
    }),
    provideLazyPort(SCHEDULE_EXCEPTION_PORTS, firebaseData, {
      factory: (m) => (inj) =>
        m.firestore.scheduleExceptionPorts(inj.get(FIREBASE_FIRESTORE)),
      methods: { writeScheduleException: LazyMethod.Promise },
      onLoadError: dataUnavailable,
    }),
    provideLazyPort(APPOINTMENT_READ_PORTS, firebaseData, {
      factory: (m) => (inj) =>
        m.firestore.appointmentReadPorts(
          inj.get(FIREBASE_FIRESTORE),
          m.firestore.guardedReads(errorHandlerLogPorts(inj.get(ErrorHandler))),
        ),
      methods: {
        observeAppointment: LazyMethod.Observable,
        observeBarberDay: LazyMethod.Observable,
        observeUpcoming: LazyMethod.Observable,
        observeHistory: LazyMethod.Observable,
        pageClientHistory: LazyMethod.Promise,
        searchAppointmentWindow: LazyMethod.Promise,
      },
      onLoadError: dataUnavailable,
    }),
    provideLazyPort(WAITLIST_READ_PORTS, firebaseData, {
      factory: (m) => (inj) =>
        m.firestore.waitlistReadPorts(inj.get(FIREBASE_FIRESTORE)),
      methods: { observeMyWaitlistRequests: LazyMethod.Observable },
      onLoadError: dataUnavailable,
    }),
    // The staff client card (client-card-redesign §6.2) and the admin page's
    // preview of a rhythm rule, which walks every client's statistics a page
    // at a time (client-card revision 3 §4.4); the spend is read on its own.
    provideLazyPort(CLIENT_STATS_READ_PORTS, firebaseData, {
      factory: (m) => (inj) =>
        m.firestore.clientStatsReadPorts(inj.get(FIREBASE_FIRESTORE)),
      methods: {
        loadClientStats: LazyMethod.Promise,
        loadClientMoney: LazyMethod.Promise,
        pageClientStats: LazyMethod.Promise,
      },
      onLoadError: dataUnavailable,
    }),
    provideLazyPort(CATALOG_PORTS, firebaseData, {
      factory: (m) => (inj) =>
        m.firestore.catalogReadPorts(inj.get(FIREBASE_FIRESTORE)),
      methods: {
        observeServices: LazyMethod.Observable,
        observeBarbers: LazyMethod.Observable,
        observeCategories: LazyMethod.Observable,
        observeLocations: LazyMethod.Observable,
      },
      onLoadError: dataUnavailable,
    }),
    // The counter's code lookups (what a typed promo code opens), a client's
    // held grants and the coupons they name whatever their status, and the
    // wallet's gift vouchers.
    provideLazyPort(COUPON_VOUCHER_PORTS, firebaseData, {
      factory: (m) => (inj) =>
        m.firestore.couponVoucherPorts(inj.get(FIREBASE_FIRESTORE)),
      methods: {
        findCouponByCode: LazyMethod.Promise,
        listOpenCoupons: LazyMethod.Promise,
        loadCouponGrant: LazyMethod.Promise,
        listUsableCouponGrants: LazyMethod.Promise,
        findGiftVoucherByCode: LazyMethod.Promise,
        listGiftVouchersForHolder: LazyMethod.Promise,
        loadCoupons: LazyMethod.Promise,
      },
      onLoadError: dataUnavailable,
    }),
    // The waitlist matcher writes a match into the recipient's inbox; the
    // menu's unread count reads it live.
    provideLazyPort(INBOX_PORTS, firebaseData, {
      factory: (m) => (inj) =>
        m.firestore.inboxPorts(inj.get(FIREBASE_FIRESTORE)),
      methods: {
        observeInbox: LazyMethod.Observable,
        markNotificationRead: LazyMethod.Promise,
      },
      onLoadError: dataUnavailable,
    }),
    provideLazyPort(APPOINTMENT_NOTE_PORTS, firebaseData, {
      factory: (m) => (inj) =>
        m.firestore.appointmentNotePorts(
          inj.get(FIREBASE_FIRESTORE),
          m.firestore.guardedReads(errorHandlerLogPorts(inj.get(ErrorHandler))),
        ),
      methods: {
        observeAppointmentNote: LazyMethod.Observable,
        saveAppointmentNote: LazyMethod.Promise,
        updateAppointmentNote: LazyMethod.Promise,
      },
      onLoadError: dataUnavailable,
    }),
    // The one bundle over both instances (`appointmentPhotoBundle`), bound
    // as its two halves and handed to features whole.
    provideLazyPort(APPOINTMENT_PHOTO_DOCUMENTS, firebaseData, {
      factory: appointmentPhotoBundle,
      methods: {
        observeAppointmentPhotos: LazyMethod.Observable,
        saveAppointmentPhoto: LazyMethod.Promise,
        deleteAppointmentPhoto: LazyMethod.Promise,
        listClientPhotos: LazyMethod.Promise,
        countPhotosByAppointment: LazyMethod.Promise,
      },
      onLoadError: dataUnavailable,
    }),
    provideLazyPort(APPOINTMENT_PHOTO_BYTES, firebaseData, {
      factory: appointmentPhotoBundle,
      methods: { uploadPhotoBytes: LazyMethod.Promise },
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
        m.firestore.customerPorts(
          inj.get(FIREBASE_FIRESTORE),
          m.firestore.guardedReads(errorHandlerLogPorts(inj.get(ErrorHandler))),
        ),
      methods: { loadCustomerForUser: LazyMethod.Promise },
      onLoadError: dataUnavailable,
    }),

    // Identity and accounts (flip 2): an account's own profile — the stored
    // `users/{uid}` body, live and once (every write is the `updateProfile`
    // callable's, Phase 4a 4A-3 (2)) — and the staff client search over
    // index #8.
    provideLazyPort(PROFILE_PORTS, firebaseData, {
      factory: (m) => (inj) =>
        m.firestore.profilePorts(inj.get(FIREBASE_FIRESTORE)),
      methods: {
        observeProfile: LazyMethod.Observable,
        loadProfile: LazyMethod.Promise,
      },
      onLoadError: dataUnavailable,
    }),
    provideLazyPort(USER_SEARCH_PORTS, firebaseData, {
      factory: (m) => (inj) =>
        m.firestore.userSearchPorts(inj.get(FIREBASE_FIRESTORE)),
      methods: { searchUsers: LazyMethod.Promise },
      onLoadError: dataUnavailable,
    }),

    // Loyalty and the rhythm's rule (flip 3): a client RECORD's account,
    // badge and season progress and its journal pages (the staff client
    // card, client-card-redesign §6.2, revision 3 §4.7); the published
    // catalogue with the rhythm's heads, memoised for the session and the
    // shop's day in the root `LOYALTY_CATALOG_MEMO`; the head, live, and its
    // versions (the card and the admin page «Ритъм»); and the publish
    // callable, which drops that same memo once a write lands (§4.4). The
    // catalogue's shop day is the clock on the DEFAULT location's wall clock
    // (4A-11) — built here, inside the lazy scope, so `@core/pipelines` and
    // `@core/systems` stay out of the initial chunk (plan §9 R10).
    provideLazyPort(LOYALTY_ACCOUNT_READ_PORTS, firebaseData, {
      factory: (m) => (inj) =>
        m.firestore.loyaltyAccountReadPorts(inj.get(FIREBASE_FIRESTORE)),
      methods: {
        loadLoyaltyAccount: LazyMethod.Promise,
        listBadgeProgress: LazyMethod.Promise,
        listSeasonProgress: LazyMethod.Promise,
      },
      onLoadError: dataUnavailable,
    }),
    provideLazyPort(LOYALTY_CATALOG_READ_PORTS, firebaseData, {
      factory: (m) => (inj) => {
        const db = inj.get(FIREBASE_FIRESTORE);
        return m.firestore.loyaltyCatalogReadPorts(
          db,
          inj.get(LOYALTY_CATALOG_MEMO),
          m.firestore.shopToday({
            ...inj.get(CLOCK_PORTS),
            ...m.firestore.locationLoadPorts(db),
            ...inj.get(DEFAULT_LOCATION_PORTS),
          }),
        );
      },
      methods: { loadLoyaltyCatalog: LazyMethod.Promise },
      onLoadError: dataUnavailable,
    }),
    provideLazyPort(CLIENT_JOURNAL_PORTS, firebaseData, {
      factory: (m) => (inj) =>
        m.firestore.clientJournalPorts(inj.get(FIREBASE_FIRESTORE)),
      methods: { pageClientJournal: LazyMethod.Promise },
      onLoadError: dataUnavailable,
    }),
    provideLazyPort(STREAK_DEFINITION_PORTS, firebaseData, {
      factory: (m) => (inj) =>
        m.firestore.streakDefinitionPorts(inj.get(FIREBASE_FIRESTORE)),
      methods: {
        observeStreakDefinitionHead: LazyMethod.Observable,
        listStreakDefinitionVersions: LazyMethod.Promise,
      },
      onLoadError: dataUnavailable,
    }),
    provideLazyPort(STREAK_PUBLISH_PORTS, firebaseData, {
      factory: (m) => (inj) =>
        m.firestore.streakPublishPorts(
          inj.get(GATEWAY_PORTS),
          inj.get(LOYALTY_CATALOG_MEMO),
        ),
      methods: {
        publishStreakRule: LazyMethod.Promise,
        withdrawStreakRule: LazyMethod.Promise,
      },
      onLoadError: dataUnavailable,
    }),

    // Programs (flip 4): the careers, courses and events pages' live lists,
    // and the admin page's suite — the three lists unfiltered, each item
    // loaded and saved whole (a rules-guarded admin write, D9(b)) — with the
    // one shop an event save reads its zone from.
    provideLazyPort(PROGRAMS_PORTS, firebaseData, {
      factory: (m) => (inj) =>
        m.firestore.programsPorts(inj.get(FIREBASE_FIRESTORE)),
      methods: {
        observePositions: LazyMethod.Observable,
        loadPosition: LazyMethod.Promise,
        savePosition: LazyMethod.Promise,
        observeCourses: LazyMethod.Observable,
        loadCourse: LazyMethod.Promise,
        saveCourse: LazyMethod.Promise,
        observeEvents: LazyMethod.Observable,
        loadEvent: LazyMethod.Promise,
        saveEvent: LazyMethod.Promise,
      },
      onLoadError: dataUnavailable,
    }),
    provideLazyPort(POSITION_READ_PORTS, firebaseData, {
      factory: (m) => (inj) =>
        m.firestore.positionReadPorts(inj.get(FIREBASE_FIRESTORE)),
      methods: { observePositions: LazyMethod.Observable },
      onLoadError: dataUnavailable,
    }),
    provideLazyPort(COURSE_READ_PORTS, firebaseData, {
      factory: (m) => (inj) =>
        m.firestore.courseReadPorts(inj.get(FIREBASE_FIRESTORE)),
      methods: { observeCourses: LazyMethod.Observable },
      onLoadError: dataUnavailable,
    }),
    provideLazyPort(SHOP_EVENT_READ_PORTS, firebaseData, {
      factory: (m) => (inj) =>
        m.firestore.shopEventReadPorts(inj.get(FIREBASE_FIRESTORE)),
      methods: { observeEvents: LazyMethod.Observable },
      onLoadError: dataUnavailable,
    }),
    provideLazyPort(LOCATION_LOAD_PORTS, firebaseData, {
      factory: (m) => (inj) =>
        m.firestore.locationLoadPorts(inj.get(FIREBASE_FIRESTORE)),
      methods: { loadLocation: LazyMethod.Promise },
      onLoadError: dataUnavailable,
    }),

    // Storage (Phase 4a 4A-7): a person's avatar, and a catalogue image's
    // renditions — each failing to load as Storage's transient answer.
    provideLazyPort(AVATAR_PORTS, firebaseData, {
      factory: (m) => (inj) =>
        m.storage.avatarPorts(inj.get(m.storage.FIREBASE_STORAGE)),
      methods: {
        uploadAvatar: LazyMethod.Promise,
        findAvatar: LazyMethod.Promise,
        removeAvatar: LazyMethod.Promise,
      },
      onLoadError: avatarsUnavailable,
    }),
    provideLazyPort(MEDIA_RESOLVE_PORTS, firebaseData, {
      factory: (m) => (inj) =>
        m.storage.mediaResolvePorts(inj.get(m.storage.FIREBASE_STORAGE)),
      methods: { resolveMedia: LazyMethod.Promise },
      onLoadError: mediaUnavailable,
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
