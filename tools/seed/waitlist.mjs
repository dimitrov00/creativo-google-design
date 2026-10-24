/**
 * МАРТИН IS WAITING (client-card-redesign.md §4.6; the client card's
 * waitlist row, §3.1.3): an open request for Thursday and Friday afternoons
 * next week — his short classic cut at Център, with whoever is free — made
 * last night at 21:10, after every booking of his, so the card's rule (no
 * upcoming visit booked since the request) lets it show.
 *
 * The document is the flat `WaitlistRequest` minus its `id`
 * (`fixtures/waitlist.fixtures.ts`, `satisfies` the archetype): the owner's
 * account, the watched days as the `localDates` query mirror beside the
 * declaration (`flexibleDays`), the cart, and the lifecycle at the root.
 * The TTL `purgeAt` is the writer's (`purgeAtFor`), never the body's.
 * Plain values in, a plain `{ path, data }` out; nothing here touches
 * Firebase.
 */
import { Weekday } from '@core/primitives';
import { waitlistRequestBody } from './fixtures/waitlist.fixtures.ts';

/** `Collections.WaitlistRequests` of `@core/entities` (the spec holds them equal). */
export const WAITLIST_REQUESTS_COLLECTION = 'waitlistRequests';

/** The one request the seed writes: whose, under which id. */
export const SEEDED_WAITLIST_REQUEST = Object.freeze({
  id: 'waitlist-dev-martin',
  ownerUserId: 'dev-client-2',
});

/** Two to five in the afternoon, on the shop's clock. */
const AFTERNOON = Object.freeze([14 * 60, 17 * 60]);

/**
 * The request on the book's today (`buildClientBook(nowMs)`), as the
 * `{ path, data }` the seed writes. Refuses a book in which he booked after
 * making it: the card would hide the row the seed writes it for.
 */
export function waitlistRequestWriteOf({ appointments, calendar }) {
  const { id, ownerUserId } = SEEDED_WAITLIST_REQUEST;
  const createdAtUtcMs = calendar.msAt(-1, 21 * 60 + 10);
  const lastBookedMs = Math.max(
    ...appointments
      .filter(
        ({ doc }) =>
          doc.subjectUserIds.includes(ownerUserId) &&
          doc.bookedAtUtcMs !== null,
      )
      .map(({ doc }) => doc.bookedAtUtcMs),
  );
  if (lastBookedMs >= createdAtUtcMs) {
    throw new Error(`seed: ${ownerUserId} booked after his waitlist request`);
  }
  const nextMonday = [1, 2, 3, 4, 5, 6, 7].find(
    (offset) => calendar.weekdayAt(offset) === Weekday.Mon,
  );
  return {
    path: `${WAITLIST_REQUESTS_COLLECTION}/${id}`,
    data: waitlistRequestBody({
      ownerUserId,
      locationId: 'loc-center',
      days: [nextMonday + 3, nextMonday + 4].map((offset) => ({
        localDate: calendar.dayKeyAt(offset),
        windows: [AFTERNOON],
      })),
      lines: [
        { serviceId: 'svc-classic-cut', variantId: 'short', barberId: null },
      ],
      createdAtUtcMs,
    }),
  };
}
