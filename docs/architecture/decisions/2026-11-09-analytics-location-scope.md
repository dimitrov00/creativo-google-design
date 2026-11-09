# Analytics per shop location — a location scope over split day documents (2026-11-09)

> **Status: BUILT** (stacked on staff analytics v3, `feat/analytics-revolut`).
> Owner question, 2026-11-09: "what if there are multiple locations?" The
> v3 scope menu answered with honest wording («Всички салони»); this records
> how one location's figures are computed. Decided under the owner's
> delegation (`feedback_owner_delegates_decisions`).

## The problem

A report's scope is the shop or one barber. With two or more locations the
shop figures sum every location, and an admin cannot see one shop's takings,
time or clients. The stored day documents (`analyticsDays/{busyKey}`,
staff analytics v2) are one per barber-day across locations and hold no
`locationId`, so they cannot answer for one location.

## Decisions

| #   | Question                                     | Decision                                                                                                                                                                                 |
| --- | -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| L1  | What is a location scope?                    | A third scope beside the shop and a barber: every barber, counted only for what happened at that location. Admins only. A barber at one location is not a combined scope.                |
| L2  | How is a live barber-day cut to a location?  | The same `daysOf`, over that location alone and the visits booked there. The roster already offers nothing at a shop it is not given (`RosterSystem.offeredWindows`).                    |
| L3  | How does a stored day answer for a location? | Two root fields: `dayLocationIds` (every location the day touched, sorted) and `dayLocations` (one figure row per touched location, in the same order, only when there are two or more). |
| L4  | When is the location choice offered?         | Only when the shop has two or more listed locations. With one, the location equals the shop.                                                                                             |
| L5  | Goals for a location?                        | Not offered. A goal belongs to the shop or a barber (`AnalyticsGoalKey`); a location scope reads no goal.                                                                                |
| L6  | Old documents?                               | `ANALYTICS_DEFINITION_VERSION` 2 → 3. Older documents read as missing and the days are computed live until the recompute rewrites them, as every definition change does.                 |

## L3 — Why split rows inside the barber-day document

Options weighed:

1. **Live only.** A location scope reads every barber-day's visits. A month
   for 10 barbers is about 300 busy keys; a year passes the adapter's caps
   and is refused. Rejected: the stored days exist to avoid exactly this.
2. **One document per barber-location-day.** The shop and barber scopes
   would read more documents, and "is this barber-day held?" would need
   every location's document. Rejected: it breaks the one-document-per-key
   rule the live/stored split relies on (`liveKeysOf`).
3. **Rows inside the barber-day document (chosen).** No extra reads or
   writes. Most barber-days touch one location, so `dayLocations` stays
   empty and the root is that location's figures: the document grows by one
   short id list. A day split across two shops carries two figure rows. The
   rows are a true 1-to-N list (Law 5) and are never queried, so
   `dayLocations` gets a `fieldOverrides` entry switching its indexes off.

A row is the location's own fold (`DayFiguresSystem.body` over the cut day),
the same figures a live location day gives. The agreement spec proves the
stored and live answers match for a location, as it does for the shop.

A stored day with no touch at the location answers an empty day for it, not
nothing, so the day still counts as held and is never computed live without
its visits.

## What a day "touches"

The locations of its offered windows, blocks and breaks, of the roster a
`CLOSED` day would have given, and of every visit with a seat of the barber
that day, in any booking status.

## Accepted residuals

- **Past day across time zones.** A location day is judged past on that
  location's clock, while a stored document is written once the day is past
  at every location the barber worked. With every shop in one zone (today)
  they agree.
- **Short gaps across shops** are each location's own: a gap between a
stretch at one shop and a stretch at another is no shop's short gap.
</content>

</invoke>
