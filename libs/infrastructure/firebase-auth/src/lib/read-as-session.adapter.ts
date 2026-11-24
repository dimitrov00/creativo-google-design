import { Observable } from 'rxjs';
import {
  type Auth,
  onIdTokenChanged,
  signInWithCustomToken,
} from 'firebase/auth';
import { ReadAsClaims } from '@core/components';
import { Result } from '@core/primitives';
import { PipelineError, PipelineErrorCode } from '@core/errors';
import type { ReadAsSessionPorts } from '@core/ports';

/**
 * THE SUPPORT READ-AS's SESSION FACTS (`ReadAsSessionPorts`, OR-24,
 * docs/designs/support-read-as.md) over Firebase Auth:
 *
 * - `observeReadAs` reads the read-as claims off each ID token as it
 *   changes — `null` on a plain session and when nobody is signed in. Off
 *   the token only, never Firestore: the banner makes no read.
 * - `signInWithReadAsToken` signs in with the token `startImpersonation`
 *   answered. Firebase keeps ONE signed-in user per browser, so the
 *   support account's own session ends here, by design: two identities in
 *   one browser is how one person's data leaks into another's session. The
 *   token itself is handed to Auth and kept nowhere.
 */
export const readAsSessionPorts = (auth: Auth): ReadAsSessionPorts => ({
  observeReadAs: () =>
    new Observable<ReadAsClaims | null>((subscriber) =>
      onIdTokenChanged(auth, (user) => {
        if (!user) {
          subscriber.next(null);
          return;
        }
        void user
          .getIdTokenResult()
          .then((token) =>
            subscriber.next(ReadAsClaims.fromToken(token.claims)),
          )
          .catch(() => subscriber.next(null));
      }),
    ),

  signInWithReadAsToken: async (customToken) => {
    try {
      await signInWithCustomToken(auth, customToken);
      return Result.ok(undefined);
    } catch {
      return Result.err(PipelineError.bare(PipelineErrorCode.Unknown));
    }
  },
});
