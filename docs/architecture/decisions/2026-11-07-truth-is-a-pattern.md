# Truth is a pattern plus its departures — ruling (2026-11-07)

> **Status: RULED (2026-11-07).** The owner answered «yes» to question 3
> of [`schedule-storage-and-lazy-evaluation.md`](../schedule-storage-and-lazy-evaluation.md)
> §12: adopt the Law 3 / Law 5 split. `CLAUDE.md` and `AGENTS.md` carry
> the text below, identically. Builds on
> [`2026-11-06-breaks-live-on-the-roster.md`](2026-11-06-breaks-live-on-the-roster.md),
> which applied the rule to weekly breaks before it was a Law.

## The ruling

What the schedule stores, and what it works out when read, follows one
rule. Its reasoning, the costs and the break-even are in §6 of the
storage document; this record holds only the words that became Law and
why they sit where they do.

**Law 5 gains a bullet** (after "Store what systems compute on"):

> - **Truth is a pattern plus its departures.** Store a repeating pattern
>   once, plus one document per day that departs from it; never write an
>   open-ended repeat ahead day by day. A series with an end date writes at
>   most 366 days, once. A derived value is stored only when a privacy
>   boundary, a busy screen's read fan-out or a transaction's conflict set
>   requires it, and then as a projection that triggers rebuild and a TTL
>   expires.

**Law 3's lazy-evaluation bullet is replaced:**

> - Lazy evaluation: compute availability windows, free times and other
>   derived views on demand from the stored pattern and its departures;
>   never pre-generate or persist slot grids. A derived value is stored only
>   as a Law 5 projection.

## Why it is split this way

- The rule decides what Firestore holds, so its home is Law 5, beside the
  other storage rules.
- Law 3 keeps its concrete words ("availability windows", "slot grids"),
  which agents and reviewers search for, and points to Law 5 for the one
  case where a derived value is stored.
- The series is named in the Law because it is the one recorded
  departure: it is written day by day, capped at 366 occurrences with no
  limit on span (storage document §6, "The recorded departure").

## What it applies to today

| Item                                    | Kind    | Stored as                        | Reason                         |
| --------------------------------------- | ------- | -------------------------------- | ------------------------------ |
| Weekly hours and breaks                 | Truth   | One roster document              | The pattern                    |
| A day that departs from the roster      | Truth   | One day change                   | A departure                    |
| A series                                | Truth   | One day change per day, ≤ 366    | The recorded departure         |
| Bookable windows, free times, free gaps | Derived | Not stored; worked out when read | No reason applies              |
| Busy days                               | Derived | Projection                       | Privacy boundary; conflict set |
| Capacity months                         | Derived | Projection                       | Read fan-out on `/book`        |

## What it changes in code

Nothing. The code already follows the rule (Phase 1, `d39a7440`, removed
the last redundant write: a rebuild no longer rewrites an unchanged
capacity month). A future change that stores a derived value must name
which of the three reasons applies, and ship its rebuild trigger and TTL
with it.
