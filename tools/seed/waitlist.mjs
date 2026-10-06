/**
 * МАРТИН IS WAITING (client-card-redesign.md §4.6; the client card's
 * waitlist row, §3.1.3): an open request for Thursday and Friday afternoons
 * next week — his short classic cut at Център, with whoever is free — made
 * last night at 21:10, after every booking of his, so the card's rule (no
 * upcoming visit booked since the request) lets it show.
 *
 * The document is `waitlistToDocument`'s: the request's props, the `dayKeys`
 * index and the `ownerUserId` mirror. `loyalty.spec.mjs` reads it back
 * through the production `waitlistFromDocument` and writes the request out
 * again, to the same document; the seed reads it back before writing it.
 * Plain values in, a plain `{ path, data }` out; nothing here touches
 * Firebase.
 */

/** `waitlist-document.ts`'s `WAITLIST_COLLECTION` (the spec holds them equal). */
export const WAITLIST_REQUESTS_COLLECTION = 'waitlistRequests';

/** The one request the seed writes: whose, under which id. */
export const SEEDED_WAITLIST_REQUEST = Object.freeze({
  id: 'waitlist-dev-martin',
  ownerId: 'dev-client-2',
});

/**
 * The request on the book's today (`buildClientBook(nowMs)`), as the
 * `{ path, data }` the seed writes. Refuses a book in which he booked after
 * making it: the card would hide the row the seed writes it for.
 */
export function waitlistRequestWriteOf({ appointments, calendar }) {
  const { id, ownerId } = SEEDED_WAITLIST_REQUEST;
  const createdAtIso = calendar.isoAt(-1, 21, 10);
  const lastBookedMs = Math.max(
    ...appointments
      .filter(({ doc }) => doc.subjectUserIds.includes(ownerId) && doc.bookedAt)
      .map(({ doc }) => Date.parse(doc.bookedAt.iso)),
  );
  if (lastBookedMs >= Date.parse(createdAtIso)) {
    throw new Error(`seed: ${ownerId} booked after his waitlist request`);
  }
  const nextMonday = [1, 2, 3, 4, 5, 6, 7].find(
    (offset) => calendar.weekdayAt(offset) === 1,
  );
  const days = [nextMonday + 3, nextMonday + 4].map((offset) => ({
    dayKey: calendar.dayKeyAt(offset),
    windows: [{ from: '14:00', to: '17:00' }],
  }));
  return {
    path: `${WAITLIST_REQUESTS_COLLECTION}/${id}`,
    data: {
      id,
      ownerId,
      locationId: 'loc-center',
      when: { days },
      cart: {
        seats: [
          {
            seatKey: 'self',
            lines: [
              {
                id: 'line-0',
                serviceId: 'svc-classic-cut',
                variantId: 'short',
                barberId: null,
              },
            ],
          },
        ],
        nextSequence: 1,
      },
      status: 'open',
      createdAtIso,
      zone: calendar.zone,
      // `array-contains` needs a flat array of scalars.
      dayKeys: days.map((day) => day.dayKey),
      // Denormalized for the rules and the owner's own listing query.
      ownerUserId: ownerId,
    },
  };
}
