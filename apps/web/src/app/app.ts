import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { E2eSignInHookService } from '@creativo/infrastructure/firebase-auth';
import { environment } from '../environments/environment';
import { AppChromeService } from './shell/app-chrome.service';
import { SessionExpiryService } from './shell/session-expiry.service';

@Component({
  selector: 'cr-root',
  imports: [RouterOutlet],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  // Instantiated for their construction side effects (data-theme/
  // data-density/lang sync, periodic session-liveness check) — the shell
  // never reads anything back from them, so these are bare `inject()`
  // calls rather than stored fields.
  constructor() {
    inject(AppChromeService);
    inject(SessionExpiryService);
    // Never wired in production builds — this exposes a
    // `window.__e2eSignIn` hook the Playwright suites sign in through.
    // Keyed on the emulators, not on dev mode: the CSP smoke runs an
    // OPTIMISED build (`web:build:csp-smoke`, OR-31) against the emulators,
    // and only `environment.ts` turns them on — the production environment
    // never does, and the custom tokens the hook takes are minted by the
    // Auth emulator's own tooling.
    if (environment.emulators.enabled) {
      inject(E2eSignInHookService);
    }
  }
}
