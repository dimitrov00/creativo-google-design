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
  provideRouter,
  withComponentInputBinding,
  withViewTransitions,
} from '@angular/router';
import { provideServiceWorker } from '@angular/service-worker';

import {
  provideFirebaseApp,
  provideFirebaseAuth,
  provideFirebaseFunctions,
  provideFirestoreDb,
} from '@creativo/infrastructure/firebase-app';
import { provideFirebaseStorage } from '@creativo/infrastructure/storage';
import { provideI18n } from '@creativo/infrastructure/i18n';

// Ports (application layer)
import { AUTH_GATEWAY, OTP_CLIENT } from '@creativo/application/identity';
import {
  APPOINTMENT_REPOSITORY,
  BOOKING_DRAFT_STORE,
} from '@creativo/application/booking';
import { CATALOG_READER, MEDIA_READER } from '@creativo/application/catalog';
import {
  COUPON_GRANT_REPOSITORY,
  REWARD_PROGRESS_READER,
  INVITATION_PORT,
} from '@creativo/application/engagement';
import {
  PROFILE_PORT,
  CONTACT_CHANGE_PORT,
  AVATAR_UPLOADER,
} from '@creativo/application/accounts';
import {
  IMPERSONATION_PORT,
  USER_SEARCH_PORT,
} from '@creativo/application/governance';
import { KEY_VALUE_STORE } from '@creativo/application/shared';

// Adapters (infrastructure layer) — named ONLY here (blueprint §1.3)
import {
  FirebaseAuthGateway,
  CallableOtpClient,
} from '@creativo/infrastructure/firebase-auth';
import {
  FirestoreAppointmentRepository,
  FirestoreCatalogReader,
  FirestoreCouponGrantRepository,
  FirestoreRewardProgressReader,
  FirestoreProfileAdapter,
  CallableContactChangeAdapter,
  FirestoreInvitationAdapter,
  FirestoreImpersonationAdapter,
  FirestoreUserSearchAdapter,
} from '@creativo/infrastructure/firestore';
import {
  FirebaseStorageAvatarUploader,
  StorageMediaReader,
} from '@creativo/infrastructure/storage';
import {
  LocalStorageKeyValueStore,
  SessionStorageDraftStore,
} from '@creativo/infrastructure/web-storage';

import { appRoutes } from './app.routes';
import { environment } from '../environments/environment';

const emulators = environment.emulators.enabled
  ? environment.emulators
  : undefined;

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
        onViewTransitionCreated: ({ transition }) => {
          const document = inject(DOCUMENT);
          const prefersReducedMotion = document.defaultView?.matchMedia(
            '(prefers-reduced-motion: reduce)',
          ).matches;
          if (prefersReducedMotion) {
            transition.skipTransition();
          }
        },
      }),
    ),
    provideServiceWorker('ngsw-worker.js', {
      enabled: !isDevMode(),
      registrationStrategy: 'registerWhenStable:30000',
    }),

    // Firebase SDK singletons (raw SDK stays behind these tokens)
    provideFirebaseApp(environment.firebase),
    provideFirebaseAuth(emulators),
    provideFirestoreDb(emulators),
    provideFirebaseFunctions(emulators),
    provideFirebaseStorage(),

    // ── Port → Adapter map (the hexagon's outer wiring, blueprint §1.3) ──
    // CLOCK/ID_GENERATOR (@creativo/application/shared) have no adapter yet
    // — no `libs/infrastructure/clock` lib exists and nothing implements
    // `IdGenerator`. Flagged rather than invented (scope guard); nothing
    // wired through Phase 5's routes consumes either token today.
    { provide: AUTH_GATEWAY, useClass: FirebaseAuthGateway },
    { provide: OTP_CLIENT, useClass: CallableOtpClient },
    {
      provide: APPOINTMENT_REPOSITORY,
      useClass: FirestoreAppointmentRepository,
    },
    { provide: CATALOG_READER, useClass: FirestoreCatalogReader },
    { provide: MEDIA_READER, useClass: StorageMediaReader },
    {
      provide: COUPON_GRANT_REPOSITORY,
      useClass: FirestoreCouponGrantRepository,
    },
    {
      provide: REWARD_PROGRESS_READER,
      useClass: FirestoreRewardProgressReader,
    },
    { provide: INVITATION_PORT, useClass: FirestoreInvitationAdapter },
    { provide: PROFILE_PORT, useClass: FirestoreProfileAdapter },
    { provide: CONTACT_CHANGE_PORT, useClass: CallableContactChangeAdapter },
    { provide: AVATAR_UPLOADER, useClass: FirebaseStorageAvatarUploader },
    { provide: IMPERSONATION_PORT, useClass: FirestoreImpersonationAdapter },
    { provide: USER_SEARCH_PORT, useClass: FirestoreUserSearchAdapter },
    { provide: BOOKING_DRAFT_STORE, useClass: SessionStorageDraftStore },
    { provide: KEY_VALUE_STORE, useClass: LocalStorageKeyValueStore },
  ],
};
