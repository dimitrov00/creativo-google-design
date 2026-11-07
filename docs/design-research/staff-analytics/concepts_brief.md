# Staff Analytics

- **Author:** Dimitar Dimitrov (owner) with Claude
- **Date:** 2026-11-07
- **Inputs:** [hypothesis.md](hypothesis.md), [competitor-research.md](competitor-research.md),
  [mobbin-inspiration.md](mobbin-inspiration.md),
  [brainstorm_review_report.md](brainstorm_review_report.md) (six-lens review: 10 blockers,
  18 majors, 11 nits), and §4 of
  [availability-and-statistics-design.md](../availability-and-statistics-design.md).

## Overview

Barbers and the shop owner run the business from this app but cannot see how it is going.
Staff analytics gives each barber their own figures on their phone — takings, tips, how their
rostered time was used, open hours ahead, which services pay best per hour, and how many
clients rebook — and gives the owner the same figures per barber and shop-wide.

The competitor research shows the opening: every salon tool (Fresha, Booksy, Square,
Boulevard) builds reports for the owner at a desk and gives the barber a cut-down or separate
view. Only theCut, a barber-only app, puts the barber's own numbers on the phone's home
screen. Fresha's retention reports sit behind a paid add-on. No salon tool offers goals; Uber
and Lyft do. Boulevard users call its reports "raw data" and ask for period-over-period change.
Trust breaks when two screens disagree on a total.

So the bet is not "more reports than Fresha". It is: **a barber-first screen whose every
figure is defined, opens to the visits behind it, and agrees with every other screen to the
cent.** Breadth (the Revolut-like depth the owner asked for) comes in stages once that
foundation holds.

## Analysis

### What the review found wrong with the first hypothesis

1. **Storage was upside down.** Rebuilding a barber's whole month from source on every write
   costs ~400 reads per write, ~4,000 for the location month — roughly 9M–170M reads a month at
   10 barbers × 15 visits a day. Folding the figures when a screen opens costs ~0.7M–2M. Law 5
   allows a stored derived value only when it saves reads; this one multiplies them.
2. **Figures that move with the clock cannot live in a write-triggered projection.** Unsold
   (past) and open (future) time shift as the day passes with no write. Only clock-independent
   facts can be stored; the past/future split happens at read time from `ShopNow`.
3. **The privacy split was cosmetic.** Every barber and receptionist can already read every
   appointment with its prices and tips (`firestore.rules:297`, `worksTheBook()`). "The
   receptionist sees no money" is a screen convention, not a security property.
4. **The app does not know which barber a signed-in user is.** `Barber` carries no `userId`
   and the token holds only roles (`firestore.rules:63-70`). "My analytics" and a per-barber
   digest both need that link.
5. **Free time had no single definition.** The schedule floors holes at 20 minutes
   (`grid-layout.system.ts:28`), the `capacity` projection counts padded free minutes with no
   floor, and the hypothesis proposed a third floor (shortest service). No-show time, future
   booked time and unclosed past visits fell into no category.
6. **The block taxonomy was richer than what is stored.** On save, sick, time off, training and
   travel all become CLOSED, and break and admin both become BLOCKED
   (`schedule-exception.system.ts:154-170`, decision D16(b)). There is no paid/unpaid flag.
7. **"Takings" was undefined.** No payment is recorded, so the figure is what was billed.
   Discounts apply to the whole bill with no per-seat split; the only allocation is a private
   per-seat rounding inside `client-stats.system.ts:804`.
8. **No metric catalogue.** Fill, rebooking, retention and growth had no formulas, and the
   §4 model's sealing and exclusions were dropped without saying so.
9. **The "unnamed shop average" leaks.** In a two-chair shop it is the colleague's exact figure.

### Where I disagree with the review

- **The review would cut the "fuller than Fresha" goal and most breadth until evidence.** The
  owner asked for depth explicitly. The right answer is staging, not cutting: v1 is the
  foundation every later figure reuses (one fold system, one allocation, one time breakdown),
  and each later stage adds figures on the same plumbing. The goal stays; it is measured by
  decisions answered, not report count.
- **An on-demand callable risks the "no lag" bar** (cold start, network). The screen renders
  the last result from a local cache at once and refreshes behind it; the callable is kept
  warm only if measurements show a cold start on the open. This is a performance gate, the
  same 4×-throttle measurement the sheets passed.
- **The shop average is useful to a barber** as a reference. Keep it, shown only when at least
  three other barbers contribute; otherwise it is absent.

## Goals vs. Non-Goals

- **In-Scope Goals (v1 — barber and admin, one screen, week | month):**
  1. **Hero:** takings so far vs the same elapsed span of the previous period; tips on their
     own line. "Takings" = billed price of attended seats after the bill's discounts, allocated
     to seats by one exported largest-remainder rule (shared with the client card).
  2. **Time bar** with four slices — worked, no-show, blocked, unsold — that sum to rostered
     time minus closed time; closed days noted underneath. Unsold uses the same holes the
     schedule draws.
  3. **Open hours in the next 7 days**, with one tap to the emptiest day.
  4. **By service:** count, takings, takings per worked hour.
  5. **Rebooking share** (defined as: the visit's client had a next visit booked before they
     left, from `bookedFromAppointmentId` and `bookedAtUtcMs`); no-show and late-cancel as
     counts until the base reaches 20 visits.
  6. **Admin extras:** the same figures per barber and shop-wide, fill by weekday, booking
     origin split, first-visit return shop-wide (as counts).
  7. **Drill-down** from every figure to the visits (`shared/visits`) or days behind it.
  8. **Plumbing:** one pure fold system, one callable, one log line per call, and a spec that
     pins the day summary, the Analytics day and the drill-down total to the same cent.
- **Staged after v1 (same plumbing):**
  - v1.1 — overdue regulars by their rhythm, weekday × hour demand grid, the Monday in-app
    card, the receptionist's forward open-time card, slivers (holes too short to book).
  - v1.2 — year view and same-period-last-year (needs the per-day stored figure set, see
    decisions), plain-language findings, goals the barber sets (Revolut budget pattern).
  - v2 — earnings with a per-barber pay rule, CSV export, sealing closed periods.
- **Out-of-Scope Non-Goals:** payroll payouts; marketing campaigns; retail/product sales;
  an AI chat over the data; a data warehouse; client-facing analytics; push notifications
  (until the in-app card proves read); custom date ranges.

## Alternatives Weighed

- **Monthly per-barber and per-location projections rebuilt from source on every write**
  (the hypothesis). Rejected: 10–100× the reads of folding on demand, and it cannot hold
  clock-dependent figures.
- **Incrementing counters (`FieldValue.increment`).** Rejected, as §4.3 already ruled:
  edits, cancellations and reschedules make counters drift with no source to re-derive from.
- **Folding on the client from the live appointment listeners.** Rejected for v1: it needs a
  month of appointments on the phone per open, and it would put the money of every barber in
  the receptionist's browser by design rather than by today's rule.
- **A per-day stored figure set (`barberId__localDate`).** Kept as the upgrade path for the
  year view (v1.2): a day's clock-independent facts, rebuilt by trigger when that day's visits
  or blocks change, with `definitionVersion` and a source digest for verification.
- **Making money a security boundary now** (moving prices and tips out of the appointment
  into a restricted document). Rejected for v1: the visit sheet shows prices to every barber
  by design. The boundary is recorded as a product convention; any money that is derived AND
  stored goes into a `restricted/` subdocument, as `clientStats` already does.
- **Amending D16(b) to store the private reason for blocks** (sick, training). Rejected:
  sick is health data under GDPR Art. 9, and the stored CLOSED vs BLOCKED split already gives
  the two categories analytics needs (closed = excluded from capacity, blocked = counted).
- **A named league table between barbers.** Rejected: friction in a small shop and
  employment-sensitive. The admin sees per-barber figures; barbers see only themselves.
- **Matching Fresha report-for-report (50 reports).** Rejected as the goal; breadth is
  staged on one foundation instead.

## Key Decisions & Staging for Next Steps

1. **Storage (v1):** no projection. One callable folds the period's visits, rosters and
   blocks on the server with pure systems; the screen caches the last answer locally and
   refreshes. Upgrade to a per-day stored figure set when the year view ships.
2. **One time-breakdown system** owns free time for the schedule, Analytics and drill-down,
   with a spec that the slices sum to the whole. The schedule's 20-minute sellable floor is
   the one floor.
3. **One discount allocation** (largest remainder, attended seats only), exported and reused
   by the client card.
4. **Barber ↔ user link:** add `accountUserId` on the barber record (and a token claim) so the
   app and rules know which chair the caller is. This also unblocks the roster rule TODO in
   `firestore.rules:63`.
5. **Visibility:** barber = own figures + shop average with a ≥3-others floor; admin =
   everything; receptionist = forward open time only (v1.1); recorded as a product rule, with
   stored derived money in `restricted/`.
6. **Every figure is versioned and defined** in a Metric Catalogue before it is built;
   rates appear only above a base of 20, counts below.
7. **Performance gate:** the Analytics screen opens without a dropped frame at 4× CPU on a
   production build, from cache, before network.

Documents to write next, in order (from the review's Appendix B): data-readiness audit →
owner ADRs (privacy convention, Barber↔User link, §4 supersession) → Metric Catalogue v1
with a decision-to-figure trace → storage ADR with cost table → time-breakdown system spec →
screen specs per role (hero, cards, drill-down, empty and small-sample states) →
instrumentation spec → v2 pay rule.
