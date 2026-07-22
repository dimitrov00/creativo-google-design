import { Component, inject, isDevMode } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { E2eSignInHookService } from '@creativo/infrastructure/firebase-auth';
import { AppChromeService } from './shell/app-chrome.service';
import { ImpersonationBanner } from './shell/impersonation-banner';
import { SessionExpiryService } from './shell/session-expiry.service';

@Component({
  selector: 'cr-root',
  imports: [RouterOutlet, ImpersonationBanner],
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
    // `window.__e2eSignIn` hook the Playwright smoke suite uses.
    if (isDevMode()) {
      inject(E2eSignInHookService);
    }
  }
}
