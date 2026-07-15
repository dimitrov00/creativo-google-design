import { DOCUMENT } from '@angular/common';
import {
  ApplicationConfig,
  inject,
  isDevMode,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import { provideRouter, withViewTransitions } from '@angular/router';
import { provideServiceWorker } from '@angular/service-worker';
import {
  provideFirebaseApp,
  provideFirebaseAuth,
  provideFirebaseFunctions,
  provideFirestoreDb,
} from '@creativo/adapters/firebase';
import { environment } from '../environments/environment';
import { appRoutes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(
      appRoutes,
      // Developer Preview as of Angular 22 — progressive enhancement only,
      // same reduced-motion opt-out pattern as apps/showcase.
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
