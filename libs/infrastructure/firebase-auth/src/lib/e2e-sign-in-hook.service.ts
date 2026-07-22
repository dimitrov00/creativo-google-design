import { DOCUMENT } from '@angular/common';
import { Injectable, inject } from '@angular/core';
import { signInWithCustomToken } from 'firebase/auth';
import { FIREBASE_AUTH } from '@creativo/infrastructure/firebase-app';

interface E2eWindow extends Window {
  __e2eSignIn?: (customToken: string) => Promise<void>;
}

/**
 * Exposes `window.__e2eSignIn(customToken)` — the hook a consuming app's
 * Playwright smoke suite uses to put the app into an authenticated,
 * role-bearing session without a real OTP round-trip (the Node-side test
 * mints the custom token via `firebase-admin` against the Auth emulator).
 * Consuming apps should only `inject()` this outside production builds
 * (e.g. `apps/web`'s `App` component guards it on `!environment.production`)
 * — this service itself has no opinion on that, it just wires the hook up
 * whenever it's instantiated.
 */
@Injectable({ providedIn: 'root' })
export class E2eSignInHookService {
  constructor() {
    const auth = inject(FIREBASE_AUTH);
    const window = inject(DOCUMENT).defaultView as E2eWindow | null;
    if (!window) return;

    window.__e2eSignIn = async (customToken: string) => {
      await signInWithCustomToken(auth, customToken);
    };
  }
}
