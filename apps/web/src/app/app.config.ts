import { DOCUMENT } from '@angular/common';
import { provideHttpClient } from '@angular/common/http';
import {
  ApplicationConfig,
  inject,
  isDevMode,
  provideBrowserGlobalErrorListeners,
  provideZonelessChangeDetection,
} from '@angular/core';
import { provideRouter, withViewTransitions } from '@angular/router';
import { provideServiceWorker } from '@angular/service-worker';
import {
  provideFirebaseApp,
  provideFirebaseAuth,
  provideFirebaseFunctions,
  provideFirestoreDb,
} from '@creativo/infrastructure/firebase-app';
import { provideI18n } from '@creativo/infrastructure/i18n';
import { environment } from '../environments/environment';
import { appRoutes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZonelessChangeDetection(),
    provideHttpClient(),
    ...provideI18n(),
    provideRouter(
      appRoutes,
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
    provideFirebaseApp(environment.firebase),
    provideFirebaseAuth(),
    provideFirestoreDb(),
    provideFirebaseFunctions(),
  ],
};
