import { bootstrapApplication } from '@angular/platform-browser';
import { Router } from '@angular/router';
import {
  CLIENT_ISSUE_REPORTER,
  clientIssueReporter,
  cspViolationIssue,
  routePatternOf,
} from '@creativo/infrastructure/firebase-app';
import { appConfig } from './app/app.config';
import { App } from './app/app';

// The page session's issue reporter (OR-34), made BEFORE the app boots so a
// Content Security Policy violation the boot itself raises has somewhere to
// go (OR-30): it buffers until `appConfig` connects it to the
// `reportClientIssues` callable, and the app's `ErrorHandler` reports into
// this same one. A violation an extension raised in the page is dropped
// (`cspViolationIssue`), and so is the measured MapLibre baseline — the
// three report-only Trusted Types sinks every map render trips
// (`MAPLIBRE_REPORT_ONLY_SINKS`), known noise that would spend the shared
// issue throttle on every landing and `/book` visit; one raised before the
// first navigation has no route to name.
const issues = clientIssueReporter(window);
let router: Router | null = null;
document.addEventListener('securitypolicyviolation', (event) => {
  const issue = cspViolationIssue(
    event,
    router === null ? null : routePatternOf(router),
  );
  if (issue !== null) issues.reportClientIssues([issue]);
});

bootstrapApplication(App, {
  ...appConfig,
  providers: [
    ...appConfig.providers,
    { provide: CLIENT_ISSUE_REPORTER, useValue: issues },
  ],
})
  .then((app) => {
    router = app.injector.get(Router);
  })
  .catch((err) => console.error(err));
