import { DOCUMENT } from '@angular/common';
import {
  ApplicationConfig,
  provideBrowserGlobalErrorListeners,
  isDevMode,
  inject,
} from '@angular/core';
import { provideRouter, withViewTransitions } from '@angular/router';
import { appRoutes } from './app.routes';
import { provideServiceWorker } from '@angular/service-worker';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(
      appRoutes,
      // Developer Preview as of Angular 22 (withViewTransitions has not
      // stabilized) — adopted as progressive enhancement only: every browser
      // without View Transitions support just keeps navigating with no
      // transition at all, and onViewTransitionCreated below opts out
      // per the same prefers-reduced-motion check ThemeService already
      // uses for prefers-color-scheme.
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
  ],
};
