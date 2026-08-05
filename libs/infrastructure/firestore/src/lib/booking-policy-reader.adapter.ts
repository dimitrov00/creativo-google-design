import { Injectable, inject } from '@angular/core';
import { Observable, distinctUntilChanged, map, startWith } from 'rxjs';
import { DocumentData, onSnapshot } from 'firebase/firestore';
import { BookingPolicy } from '@creativo/domain/scheduling';
import {
  type BookingPolicyReader,
  policyFromDocument,
} from '@creativo/application/booking';
import { FIREBASE_FIRESTORE } from '@creativo/infrastructure/firebase-app';
import { bookingPolicyDocRef } from './firestore-paths';
import { subscribeWithRetry } from './subscribe-with-retry';

/**
 * The tenant's booking policy, live, with the shipping defaults as the floor.
 *
 * ### Every failure mode lands on the defaults
 * A missing document, a malformed one, a field an admin fat-fingered to zero —
 * all of them fall through to `BookingPolicy.default()`. This is deliberate
 * and it is why the port does not return a `Result`: the alternative to a
 * usable policy is a booking flow that will not open, and no shop is better
 * off with a dark `/book` than with a two-month horizon they did not choose.
 * A tenant with no policy document is the NORMAL case today, not a failure.
 *
 * ### It is a snapshot listener
 * The horizon is the number most visibly on screen in this flow — it is
 * literally how far the calendar scrolls. A shop that extends it should see
 * the extra months appear, not on the next reload.
 *
 * This is the seam an admin editor writes through. Until one exists nothing
 * downstream can tell the difference, which is the point.
 */
@Injectable()
export class FirestoreBookingPolicyReader implements BookingPolicyReader {
  private readonly db = inject(FIREBASE_FIRESTORE);

  observe(): Observable<BookingPolicy> {
    return subscribeWithRetry<DocumentData | null>((next, error) =>
      onSnapshot(
        bookingPolicyDocRef(this.db),
        (snapshot) => next(snapshot.data() ?? null),
        error,
      ),
    ).pipe(
      // UNWRAP the Result before mapping. `subscribeWithRetry` emits
      // `Result<DocumentData|null>`, and an earlier version piped the wrapper
      // itself into `toPolicy` — which COMPILED (DocumentData's index
      // signature accepts any object) and then read every field as
      // `undefined` off the Result instance, so a perfectly-authored policy
      // doc was silently ignored and the tenant knob did not exist at all.
      map((result) =>
        result.isSuccess()
          ? policyFromDocument(result.value)
          : BookingPolicy.default(),
      ),
      // The listener's first emission is a round trip away, and the calendar
      // renders before it lands. Starting on the defaults means the grid is
      // never briefly empty — it is briefly the standard policy.
      startWith(BookingPolicy.default()),
      // Identity stabilized at the SOURCE: the seeded doc usually SAYS the
      // defaults, and without this the doc's arrival emitted a
      // field-identical policy under a new identity — which every downstream
      // `switchMap` read as "the policy changed" and answered by tearing
      // down and re-billing its whole listener set.
      distinctUntilChanged((a, b) => a.equals(b)),
    );
  }
}
