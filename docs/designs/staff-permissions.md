# Staff permissions: the owner decides who may do what

- **Author:** Dimitar Dimitrov (owner), drafted with Claude
- **Date:** 2026-11-13, revised 2026-11-14
- **Stage:** Design brief, revised after its first review round
  (`docs/designs/staff-permissions-review/goldfish_review_round1.md`: 2
  blockers, 24 major findings, 25 nits). "Review record" at the end says
  where each finding went. Stage 0 is built and merged; stage A is built
  (PR #78); stage T is next.
- **Decisions:** the owner delegated them. Each is the author's call and the
  owner may overturn any of them; the ones most worth a look are under "Open
  decisions".
- **Builds on:** `docs/designs/team-onboarding.md`. Its decision D5 fixed the
  permissions in code; this brief makes them the owner's to set. Ids in this
  brief (P, G, O, R, and the stage letters) are this document's own. An id
  from the other document is always written with its name.

## Overview

### The problem

The owner asked for two things:

1. The shop owner can also be a barber.
2. The owner decides who is allowed to do what: book for a colleague, see a
   colleague's schedule, block time for them, and so on, as Fresha and
   similar products allow.

Before this work an account held a set of roles (`barber`, `receptionist`,
`content_manager`, `admin`, the vendor's `sysadmin`, and `client`). What
each role may do is a fixed list in code (`Roles.*`,
`libs/ecs-core/src/components/roles.data.ts`), repeated in
`firestore.rules`. Changing any of it takes a release. The data model
already let one account be `barber` and `admin` together, linked to a
barber record; what stopped a sole owner was that `setRoles` refused every
change to the caller's own account. Stage 0 removed that block.

### What this design adds

1. A closed list of **capabilities**. Each is one thing a staff member may
   do or see. Twelve are planned; a capability exists in the code, and in
   the owner's screen, only from the stage that enforces it (P13).
2. **Levels.** They are today's staff roles, plus a «Управител» (manager)
   level in a later stage. The owner sets what each level may do.
3. A **scope** for capabilities that concern one barber's work: nobody, own
   only, or everyone. "Own only" is offered on the barber level, the only
   one that can have something of its own.
4. One settings document that holds the owner's choices, one value per
   level and capability. The defaults stay in code and reproduce today's
   behaviour.
5. **Enforcement on the server**, on the stored account. What the browser
   reads directly is governed by the security rules, which read the same
   document; that part waits for a spike (stage S).
6. A «Права» (permissions) screen for the owner.
7. **The owner as a barber.** An admin may link their own account to a
   barber record. Built.

**Stages,** named throughout: 0 the owner as a barber (built) · A the
engine · T the Team screen · B the booking calls · S the spike for reads ·
C what the rules guard · M the manager level. "Staging" has each in full.

### What changed in this revision

- **Stored shape.** One value per level and capability, not a list of roles
  per capability. A level or a default added later now needs no stored-data
  change (P5).
- **A capability cannot be set before it is enforced** (P13).
- **Twelve capabilities, not sixteen.** A seat's price joins the discount
  row; content and the loyalty programme stay fixed; opening a client's card
  follows working the book (P2).
- **"Own" for a visit** means the caller is one of its barbers (P3, O4).
- **The stages are re-cut**, each with named exit tests. The reads have
  their own spike, and the manager level has a fixed place.
- The server contract, the errors, the editor's callable and the file list
  for stage A are written out (P6, P12).

### Words used in this brief

| Word           | Meaning                                                                                                                     |
| -------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Capability     | One thing a staff account may do or see, from a closed list (P2).                                                           |
| Level          | A staff role an account holds: `barber`, `receptionist`, `content_manager`, later `manager`. `client` is not a level.       |
| Scope          | `NONE`, `OWN` or `ALL`. A capability that is not about one barber's work is a switch: `NONE` or `ALL`.                      |
| Cell           | One level's scope for one capability. The owner edits cells.                                                                |
| Own            | The barber record the caller's stored account is linked to (`users/{uid}.linkedBarberId`).                                  |
| Owner          | An account that holds `admin`. There may be more than one. "The owner" also names the person who commissioned this brief.   |
| Vendor         | The software's maker. Its support role is `sysadmin`.                                                                       |
| Act            | A change: through a callable, or written by the browser under a security rule.                                              |
| Read           | Data read: straight from Firestore or Storage under a security rule, or answered by a callable.                             |
| Token          | The signed-in session's ID token. It carries the `roles` claim.                                                             |
| Wire gate      | The first check of a callable, on the token, before any document is read (`apps/functions/src/wire/*.wire.ts`).             |
| Works the book | Holds a role in the rules' `worksTheBook()` list (`barber`, `receptionist`, `admin`, `sysadmin`): reads visits and clients. |
| Lane           | One barber's column on the staff schedule.                                                                                  |

Bulgarian labels are the words the screens print. Each is glossed once
where it first appears.

## Analysis

### How access is decided today

Three layers decide, and each holds its own copy of the lists.

| Layer          | What it reads                                                                                 | Where                                                                                                                                                           |
| -------------- | --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Security rules | The token's `roles` claim                                                                     | `firestore.rules` helpers `isStaff()`, `worksTheBook()`, `isCatalogManager()`, `isAdmin()`, two inline role lists; `storage.rules` has its own `worksTheBook()` |
| Callables      | The token's roles at the wire gate. Some then re-read the stored account                      | `apps/functions/src/wire/*.wire.ts`, then the pipelines and systems of `libs/ecs-core`                                                                          |
| Web            | The token's roles for route guards and menu entries; the stored account for the linked barber | `rolesGuard` (`apps/web/src/app/guards/roles.guard.ts`), `SessionIdentityService`, and gates in the staff dashboard, the client card and the analytics store    |

Facts that shape the design, each read in the code:

1. **No Firestore rule reads the stored account or a settings document.**
   The rules judge the token. (`storage.rules` reads `users/{uid}` once per
   upload, to refuse an erased account.)
2. **The claims are fixed for the session.** They are minted with
   `createCustomToken` at sign-in (`verify-otp.pipeline.ts`,
   `complete-registration.pipeline.ts`); nothing calls
   `setCustomUserClaims`. A role change reaches a session only after a new
   sign-in. `setRoles` revokes the target's refresh tokens, the open web app
   notices within five minutes (`SessionExpiryService`,
   `apps/web/src/app/shell/session-expiry.service.ts`), and the rules keep
   honouring the old token until it expires, up to an hour.
3. **Some callables judge the stored account, some only the token.**
   - Stored, inside the call's transaction: `setRoles`, the three roster
     calls and the six team calls.
   - Stored, read just before the work: the two analytics calls
     (`staffAnalytics` has no transaction at all), the three privacy calls
     and `runBackfill`.
   - Token only: the staff path of `commitBooking`,
     `transitionAppointment`, `markArrived`, `clearArrival`,
     `recordSeatTip`, `staffEditAppointment`, the impersonation calls and
     `publishStreakDefinition`.
4. **Staff read most of the book straight from the browser.** Under
   `worksTheBook()`: `appointments`, `appointmentNotes`,
   `appointmentPhotos`, `customers` (get and list), `clientStats`, the
   loyalty documents, `clientJournal`, `couponGrants`, `giftVouchers` and
   single `users` documents. They also write notes and photos there.
   Listing `users` is an inline list: `receptionist`, `admin`, `sysadmin`.
   A client's lifetime spend (`clientStats/*/restricted/*`) is an inline
   `admin`.
5. **"Own only" exists in three places.** Hours and day exceptions
   (`RosterAccessSystem`), the profile edit (`TeamSystem.admitProfileEdit`)
   and analytics (`StaffAnalyticsSystem`). Each compares the call's barber
   with the stored account's link.
6. **No callable writes a settings document.** `settings/*` is readable by
   anyone and written only with the Admin SDK. Any write there starts three
   triggers: a whole-shop capacity rebuild, a generic audit row, and a
   client-statistics recompute that exits unless the document is the booking
   policy.
7. **A link needs the `barber` role.** `RoleAssignmentSystem` refuses a
   link on an account without it and clears the link when the role goes.

### Gaps found while mapping

These were found on `main` and are not caused by this design.

| Gap | What it is                                                                                                                                                                                | Status            | Closed by                                                                                              | Residual                                                          |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------- |
| G1  | A seat's price change was not money-gated on the server; only a new manual discount was. The web offers no price field, so it took a crafted call.                                        | Closed 2026-11-14 | PR #76 (`BillingSystem.repriceRefusal`, on the token's roles). Stage B moves it to the stored account. | Token-gated until B.                                              |
| G2  | The token-only callables honour a removed role for up to an hour (fact 3).                                                                                                                | Open              | Stage B, for the booking calls, the impersonation calls and `publishStreakDefinition`.                 | Rule-guarded reads still follow the token for up to an hour (R7). |
| G3  | Keeping a client's own words from `sysadmin` is web-only: `Roles.readsClientWords` is asked in `client-card.store.ts` and nowhere on the server or in the rules.                          | Open              | Not this design. It is a question about the vendor's access, listed here so it is not lost.            | The whole gap.                                                    |
| G4  | The staff client search has no web gate. Its `users` half is refused for a barber by the rules and silently skipped; its `customers` half answers, so a barber can search client records. | Open              | Stage T (the web gate) and stage C (`CLIENT_SEARCH` covers both halves).                               | None after C. The barber's screen was read in the code, not run.  |

### What comparable products do

Read from the vendors' help pages (sources at the end).

| Product | Structure                                                      | Own versus everyone                                           | The owner                                                 |
| ------- | -------------------------------------------------------------- | ------------------------------------------------------------- | --------------------------------------------------------- |
| Fresha  | Editable permission roles, custom ones allowed                 | Calendar and reports: own or whole team                       | One owner with full access, changed only by transfer      |
| Booksy  | Five fixed levels, a few per-person toggles on the lower three | Calendar, checkout and takings: own or all                    | Full access; the owner and the manager also take bookings |
| Square  | Permission sets built from a base level; three default sets    | Calendar: own or all team members                             | Outside the sets, full access                             |
| Vagaro  | Editable access levels, five preset, custom ones allowed       | Paired permissions: own or others' calendar, profile, reports | No access level; always full access                       |

What they share:

- Every product assigns a named bundle to each person. None starts from
  per-person switches.
- Three of the four let the owner edit what a bundle grants.
- "Own or everyone" is a first-class choice for the calendar in all four,
  and for takings in three.
- Seeing a client's contact details is a separate switch from seeing their
  name and history.
- The owner sits outside the system with full access. Editing permissions is
  itself restricted.
- Whether a person takes clients is separate from what they may do. An owner
  who cuts hair is one person with both.
- The usual ladder is service provider, front desk, manager, owner.

### Is this attribute-based access control?

Partly. The levels are role-based. The scope adds one attribute: which
barber record is the caller's. A general policy language (conditions on
time, shop, amount or any field) is not needed for a shop of a handful to a
few dozen people, and nobody could audit it by reading a screen. If a second
attribute is ever needed, it becomes a new scope value or a new capability,
not a language.

## Goals vs. Non-Goals

- **Goals:**
  - The owner changes what each level may do from inside the app. A change
    applies to the next call, and nobody is signed out.
  - "Own or everyone" is a first-class scope.
  - The defaults reproduce today's behaviour, and a spec pins that. The two
    departures are named: the barber's client search (O10), and the Team
    list answering barber records to whoever may edit every profile (P6).
  - What the owner can set is enforced. A capability is not offered before
    the server or the rules honour it.
  - The owner cannot lock themself out. Owner-only acts cannot be given
    away.
  - One function decides, for the server and the web.
  - Every permission change is audited with who made it.
  - An owner can be a barber on the same account.
- **Non-Goals:**
  - Exceptions for one person. A person's rights come from their levels
    (O3).
  - Levels the owner names and creates (O6).
  - Conditions on time, shop or amount, such as a discount limit that needs
    approval. A grant applies at every shop.
  - Changing how token claims are minted.
  - Permissions for the vendor's `sysadmin`. It keeps today's fixed place
    per capability and is not shown.
  - Client-facing permissions. A client's own bookings are unchanged.
  - Closing G3.

## Alternatives Weighed

- **More fixed roles.** Rejected: every new wish is a release, and the lists
  already exist in three copies.
- **Per-person switches with no levels.** Rejected: no product surveyed
  starts there, and a few dozen people times a dozen switches is unreadable.
- **Fixed levels plus a short list of switches** (Booksy's shape). Rejected:
  the owner asked that "everything could be feature gated". Once the engine
  exists, a switch and a cell cost the same to enforce, and the catalogue
  was cut to twelve rows to keep the screen short.
- **Only callables configurable; the rules stay role-based.** Adopted for
  now: that is stages A and B, which cover booking for a colleague and
  blocking time for them. The rules follow only if the spike (stage S) says
  the cost and the behaviour are acceptable.
- **Owner-named custom levels.** Not designed. `Role` is a closed dictionary
  shared by the claims, the rules, the audit rows and the words, and the
  stored shape (P5) has one fixed field per level, so a custom level would
  need its own design.
- **A policy engine.** Rejected, as "Is this attribute-based access
  control?" explains.
- **Grants as token claims.** Rejected: the claims are fixed for the session
  (fact 2), so every change would sign the whole team out, and each person
  signs back in with an emailed code.
- **Moving the role claims to `setCustomUserClaims`.** Not needed: the
  server judges the stored account. It may still be worth doing on its own.
- **A list of roles per capability** (this brief's first draft). Rejected in
  review: narrowing one level froze every other level's answer for that
  capability, so a level or a default added later was silently lost. It was
  chosen so the rules could test one `hasAny`; one clause per level costs
  the rules nothing more.
- **A list of capabilities per level, or an array of grant structs.**
  Rejected: the rules cannot search an array of maps, and a per-level list
  cannot tell "the owner removed this" from "this capability did not exist
  when the list was saved".
- **Reading the caller and the document just before the transaction, for
  every call.** Rejected for the calls that already judge the account
  inside their transaction: it would weaken them from "atomic with the act"
  to "as of a moment before". Used where there is no transaction to read
  in (P6).
- **Caching the document in each Functions instance.** Rejected: a cache
  would delay a narrowing.
- **Keeping each domain's own "forbidden" code** instead of one access
  dictionary. Rejected: the refusal could not name the capability, so the
  screen could not say what is missing and refusals could not be counted
  per capability. The cost is renaming four codes across the server, the
  words and three web stores (P6).
- **Hiding things in the web only.** Rejected as a boundary. The web hides
  what the server would refuse, and the server stays the authority.

## Key Decisions

### P1. Levels are the roles, and the owner edits what a level grants

| Level (stored role) | Word                          | Editable                                            |
| ------------------- | ----------------------------- | --------------------------------------------------- |
| `barber`            | Бръснар (barber)              | yes; the only level offered "own only"              |
| `receptionist`      | Рецепция (front desk)         | yes                                                 |
| `content_manager`   | Съдържание (content)          | yes                                                 |
| `manager` (stage M) | Управител (manager)           | yes, from stage M                                   |
| `admin`             | Администратор (administrator) | no: everything, always (P4)                         |
| `sysadmin`          | not shown                     | no: the vendor's support role, fixed per capability |

- An account holds a set of levels. For each capability it gets the widest
  scope any of its levels grants.
- `client` is a role and not a level. It is never offered and never read as
  one.
- **A manager level is added, in its own stage** (O2, stage M). Without it
  the only way to hand over running the team is `admin`, which can also
  change roles and erase client data. Because the stored shape has one
  field per level (P5), adding the level later changes no stored data, so
  it does not hold up stage A.
- **Taking clients is not a permission.** It is the barber record, which is
  bookable with no account at all (team onboarding D1). The link between an
  account and a record is what gives "own" a meaning.
- Who holds which level is still set in «Роли» (roles, `setRoles`), by the
  owner.

### P2. The capability catalogue

| Group   | Capability       | What it covers                                                                                                       | Values     | Needs            | Enforced by                                                                                                                              | Enters |
| ------- | ---------------- | -------------------------------------------------------------------------------------------------------------------- | ---------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| График  | `BOOKING_VIEW`   | See visits on the schedule, with their notes and photos                                                              | set by S   | —                | Rules, read: `appointments`, `appointmentNotes`, `appointmentPhotos` and its Storage objects                                             | C      |
| График  | `BOOKING_MANAGE` | Book, move, edit, cancel; mark arrived, completed or no-show; record a tip; honour a coupon or voucher               | own or all | works the book   | Callables: `commitBooking` (staff path), `transitionAppointment`, `markArrived`, `clearArrival`, `recordSeatTip`, `staffEditAppointment` | B      |
| График  | `TIME_OFF`       | Block time, clear or move a block, change one day's breaks                                                           | own or all | —                | Callable: `setDayExceptions`                                                                                                             | A      |
| График  | `HOURS`          | Weekly hours and standing breaks                                                                                     | own or all | —                | Callables: `setRosterWeek`, `amendRosterBreaks`                                                                                          | A      |
| Каса    | `BOOKING_MONEY`  | Give a manual discount; change a seat's price                                                                        | switch     | `BOOKING_MANAGE` | Callable: `staffEditAppointment` (a new manual discount, a seat's new price)                                                             | B      |
| Клиенти | `CLIENT_SEARCH`  | Search the whole clientele: client records and registered accounts                                                   | switch     | works the book   | Rules, list: `users`, `customers`                                                                                                        | C      |
| Клиенти | `CLIENT_CONTACT` | See a client's phone and email                                                                                       | switch     | works the book   | Rules, read: a restricted sibling document the contact fields move to (stage S decides)                                                  | C      |
| Клиенти | `CLIENT_SPEND`   | See a client's lifetime spend                                                                                        | switch     | works the book   | Rules, read: `clientStats/*/restricted/*`                                                                                                | C      |
| Анализи | `ANALYTICS`      | Own: own numbers and own goal. All: the shop and every barber's numbers, the shop's goal                             | own or all | —                | Callables: `staffAnalytics`, `setAnalyticsGoal`                                                                                          | A      |
| Екип    | `TEAM_PROFILES`  | A barber's name, title, bio, Instagram, experience                                                                   | own or all | —                | Callable: `editBarber` (profile part)                                                                                                    | A      |
| Екип    | `TEAM_OFFERINGS` | A barber's services, prices and durations                                                                            | own or all | —                | Callable: `setBarberOfferings`                                                                                                           | A      |
| Екип    | `TEAM_MANAGE`    | Add a barber; shops, working period, booking access, «Който и да е» (any barber); delete a draft; the full Team list | switch     | —                | Callables: `addBarber`, `editBarber` (other parts), `deleteDraftBarber`, `listTeam`                                                      | A      |

The groups are the screen's: График (schedule), Каса (till), Клиенти
(clients), Анализи (analytics), Екип (team). "Enters" is the stage that
adds the capability to the code and to «Права» (P13).

The owner's three examples map to cells: booking for a colleague is
`BOOKING_MANAGE` at everyone, blocking time for them is `TIME_OFF` at
everyone, and seeing a colleague's schedule is `BOOKING_VIEW`, which the
spike decides (stage S).

**"Needs" is a rule, not a note.** `StaffAccessSystem.scopeOf` never
answers a wider scope for a capability than the account has for the one it
needs, and a capability that needs working the book is offered only on a
level that works the book. The editor shows the dependent row as
unavailable and says why. So a discount can never reach further than the
visits a person may change, and a hand-edited document cannot turn that
round. If `BOOKING_VIEW` enters (stage S), it takes the place of "works the
book" for visits, and `BOOKING_MANAGE` then needs it.

**Defaults.** «—» is nobody. The owner always has everything. `sysadmin` is
fixed and not editable.

| Capability       | Бръснар | Рецепция | Съдържание | `sysadmin` (fixed) | Today's source                                                     |
| ---------------- | ------- | -------- | ---------- | ------------------ | ------------------------------------------------------------------ |
| `BOOKING_VIEW`   | all     | all      | —          | all                | `worksTheBook()` (`firestore.rules`)                               |
| `BOOKING_MANAGE` | all     | all      | —          | all                | `Roles.BOOK`                                                       |
| `TIME_OFF`       | own     | all      | —          | all                | `Roles.ROSTERS`; own: `RosterAccessSystem.admitDays`               |
| `HOURS`          | own     | all      | —          | all                | `Roles.ROSTERS`; own: `RosterAccessSystem.admit`                   |
| `BOOKING_MONEY`  | —       | yes      | —          | yes                | `Roles.MONEY`                                                      |
| `CLIENT_SEARCH`  | yes     | yes      | —          | yes                | The `users` list rule; `customers` read. Differs for Бръснар (O10) |
| `CLIENT_CONTACT` | yes     | yes      | —          | yes                | `worksTheBook()`                                                   |
| `CLIENT_SPEND`   | —       | —        | —          | —                  | `Roles.SPEND`; the `restricted` rule                               |
| `ANALYTICS`      | own     | —        | —          | —                  | `Roles.ANALYTICS_SELF`, `Roles.ANALYTICS_SHOP`                     |
| `TEAM_PROFILES`  | own     | —        | all        | —                  | `Roles.TEAM_PROFILES`; own: `TeamSystem.admitProfileEdit`          |
| `TEAM_OFFERINGS` | —       | —        | —          | —                  | `Roles.TEAM`                                                       |
| `TEAM_MANAGE`    | —       | —        | —          | —                  | `Roles.TEAM`                                                       |

**Not configurable.** As today:

- Owner only: roles and links (`setRoles`), the permissions themselves
  (`setStaffPermissions`), export and erasure of a client's data.
- Owner and the vendor's `sysadmin`: impersonation, the audit log, trigger
  failures, and the loyalty programme (`publishStreakDefinition`, its
  version history, the `admin/loyalty` routes).
- The «Съдържание» level: positions, courses and events
  (`isCatalogManager()`, the `admin/programs` route). A person who should
  edit them is given the level.
- Vendor only: `runBackfill`.

**Left at the fixed staff tier.** None of these is something an owner asks
to restrict.

- Any staff member: `activateBarber` (any staff member's save may complete
  a setup), reading draft barber records, the waitlist, lead-time samples
  and invitation lists.
- Whoever works the book: opening a client's card (the record, statistics,
  loyalty, journal, coupons, vouchers, single `users` documents), which the
  visit sheet itself needs; and writing a note or a photo on a visit (O9).

**Client-facing, unchanged.** `requestOtpChallenge`, `verifyOtpChallenge`,
`completeRegistration`, `updateProfile`, `cancelAppointment`,
`rescheduleAppointment`, `requestWaitlist`, `cancelWaitlist`,
`redeemInvitation`, `reportClientIssues`.

**One exception to "links are the owner's".** `deleteDraftBarber`
(`TEAM_MANAGE`) clears the link of an account linked to the deleted draft.
It can only take "own" away, never give it.

### P3. Own and everyone

- **Own** is the barber record the caller's stored account is linked to.
  Only an account that holds `barber` can have a link (fact 7), so "own
  only" is offered on the barber level alone. On every other level a cell
  is nobody or everyone. An account that holds `barber` with no link has
  nothing of its own, and an own-only grant refuses it.
- An act names its target, and the target decides what own-only admits:

  | Target  | Used by                                                   | Own-only admits when                               |
  | ------- | --------------------------------------------------------- | -------------------------------------------------- |
  | Barbers | Hours, time off, profiles, offerings                      | Every barber the call names is the caller's record |
  | Shop    | Adding a barber, the Team list, anything naming no barber | Never: it needs everyone                           |
  | Visit   | The booking calls (stage B)                               | The caller's record is one of the visit's barbers  |

- A call that names no barber is a shop target. It is never "own" by
  default.
- **Hours and time off.** Every barber the call names. This is today's
  `RosterAccessSystem.admit` and `admitDays`, so a barber still cannot move
  a block onto a colleague.
- **Profiles and offerings.** The barber record the call names.
- **Bookings (stage B, O4).** A visit is the caller's own when their record
  is one of its barbers. Own-only lets a caller act on their own visits and
  put work only on themself:

  | Call                                                                    | Own-only admits when                                                                                                      |
  | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
  | `commitBooking` (staff path)                                            | Every seat's barber is the caller. A staff «Който и да е» booking, where the server picks the barber, needs everyone      |
  | `transitionAppointment`, `markArrived`, `clearArrival`, `recordSeatTip` | The caller is one of the stored visit's barbers                                                                           |
  | `staffEditAppointment`                                                  | The caller is one of the stored visit's barbers, and every seat the batch adds or moves to another barber is the caller's |

  So a barber limited to their own visits books and edits for themself, may
  check in or cancel a party they share with a colleague, and cannot book,
  move or add a seat onto a colleague.

- **Analytics** does not use the targets. It asks only for the caller's
  scope and keeps its own rules: nobody refuses; everyone reads as today's
  shop reader; own needs a link, reads a request that names no barber as
  the caller's own record, and refuses another barber or a shop filter.
  Setting a goal stays as today: a person sets their own, the shop's goal
  needs everyone, and nobody sets a colleague's.
- **A barber who has left.** The leaving flow (team onboarding stage 1b)
  takes the leaver's `barber` level and link, so no account keeps an "own"
  on a departed record. Until it is built, the record checks that run after
  access is admitted (hours and profiles refuse a departed record) stay as
  they are.
- Everyone on any level the account holds wins.

### P4. The owner is never locked out

- `admin` has everything. `StaffAccessSystem.scopeOf` answers so before it
  reads a cell, and the document has no field for `admin` or `sysadmin` at
  all. A document edited by hand in the console cannot lock the owner out
  or change the vendor's place.
- The rules test `admin` before they read the document.
- Editing permissions is owner-only and cannot be granted (`Roles.ASSIGN`,
  the list that already guards `setRoles`). The last-admin invariant of
  `RoleAssignmentSystem` is unchanged.
- No level can raise itself: the only writer of the document is the
  owner-only callable.

### P5. Where the grants live

One document, `settings/staffPermissions`. One root field per editable
level and capability, holding that cell's scope, or `null` when the cell
follows the default:

```text
/settings/staffPermissions
  barberHoursScope:              null      // follows the default (own)
  barberTimeOffScope:            'ALL'     // the owner lets barbers block time for each other
  receptionistHoursScope:        'NONE'    // the owner took hours from the front desk
  contentManagerTeamManageScope: null
  …                                        // every level × capability in the code
  writeOperationId:              'op-7f3a…' // the save that last wrote it
```

- **Field names.** `<level><Capability>Scope`, spelled out once in a table
  in `staff-permissions.data.ts`. Three levels and the six capabilities of
  stage A are eighteen fields; the full plan (four levels, twelve
  capabilities) is forty-eight. Every name is fixed at design time, so the
  document holds no dynamic keys and no arrays (Law 5).
- **The document is the entity.** `StaffPermissionsSettings` is the fixed
  id `'staffPermissions'` with the `StaffPermissions` cells and
  `WriteProvenance`, beside `BookingPolicySettings`. Every field is
  always present; a cell that follows the default holds `null`. A save
  writes the whole body.
- **A pattern and its departures.** The code holds
  `StaffPermissions.DEFAULT` (the table in P2) and the fixed `sysadmin`
  column. The document holds only what the owner changed: a save stores
  `null` for a cell that is back at its default. No document means every
  cell follows the default. A cell left at `null` follows a default that is
  corrected later.
- **Later levels and capabilities.** A new capability or level adds fields.
  A document written before it has no such field, which reads as `null`,
  the default. Nothing stored is rewritten.
- **The reading guard** `StaffPermissions.read(raw)` never fails, and the
  rules give the same answers:

  | Stored value                                                          | The guard and the rules read it as |
  | --------------------------------------------------------------------- | ---------------------------------- |
  | No document; no such field; `null`                                    | The default                        |
  | A scope the cell offers (`'NONE'`, `'ALL'`, and `'OWN'` on Бръснар)   | That scope                         |
  | Anything else: an unknown string, a number, a list, `'OWN'` off-level | Nobody (`NONE`)                    |

  A value the system cannot read grants nothing (O11). Only a hand edit can
  produce one; the callable writes valid cells. The owner still has
  everything and repairs it in «Права».

- **Who reads and writes it.** Only the `setStaffPermissions` callable
  writes, and it never deletes the document. Reading narrows to staff for
  this one document from stage A: the `settings/{docId}` rule becomes
  `allow read: if docId != 'staffPermissions' || isStaff();`. Only a staff
  session subscribes to it, because a refused settings read once caused a
  retry loop (`firestore.rules`, the `settings` comment).
- **The two settings triggers.** The capacity rebuild is filtered to
  `settings/bookingPolicy`, so a permissions save rebuilds nothing. The
  generic audit row is skipped for a write the callable stamped (P11).
- **Indexes.** No query reads these fields. `writeOperationId` gets the
  `fieldOverrides` entry every other stamped collection has.

### P6. Enforcement on the server

**One pure system.**

```text
StaffAccessSystem.scopeOf(permissions, staffCapability, roles): AccessScope
StaffAccessSystem.admit({ staffCapability, accessTarget, caller, permissions, nowUtcMs }): Result<User, AccessError>
```

`roles` is read as the claims are: unknown strings are ignored. `admit`
answers the stored account, which the pipelines need for the audit row.

| Case                                                                            | Answer                                |
| ------------------------------------------------------------------------------- | ------------------------------------- |
| The account is missing, blocked or erased at `nowUtcMs`, or holds no staff role | `ACCESS_NOT_STAFF`                    |
| The scope is nobody                                                             | `ACCESS_DENIED { staffCapability }`   |
| The scope is everyone                                                           | The account                           |
| Own, a shop target                                                              | `ACCESS_OWN_ONLY { staffCapability }` |
| Own, no linked record                                                           | `ACCESS_OWN_ONLY { staffCapability }` |
| Own, a barbers target naming any record but the caller's, or naming none        | `ACCESS_OWN_ONLY { staffCapability }` |
| Own, a barbers target naming only the caller's record                           | The account                           |
| Own, a visit target with the caller's record among its barbers (stage B)        | The account                           |
| Own, a visit target without the caller's record (stage B)                       | `ACCESS_OWN_ONLY { staffCapability }` |

**What "converted" means for a callable.**

1. The wire gate asks only "is staff" on the token (`Roles.isStaff`). The
   token cannot know the cells. It keeps clients and anonymous callers out
   before anything is read.
2. The pipeline's own token check goes too (`admitTeamCaller` becomes the
   staff check `admitTeamStaffCaller` already is).
3. The pipeline reads `users/{caller}` and the document, then asks `admit`
   in place of the caller check it had. The order of everything else stays.
4. The record checks stay and run after: an unknown barber, a departed
   record, a shop the barber does not work at.

**Where the two documents are read.**

- A pipeline that already reads the caller inside its transaction (the
  roster and team calls) reads both there, in its first read step, so they
  cost no extra round trip. `listTeam` reads them first and stops before
  its four collection queries when the caller is refused.
- The analytics pair has no transaction to read in. It reads the document
  through a new port bundle, `StaffPermissionsReadPorts`, whose one
  function `loadStaffPermissions` sits beside the `loadProfile` it already
  calls. The
  answer is "as of this call", not atomic with a write; analytics writes
  nothing that needs more.
- So the shared reader is two functions, one over the transaction and one
  over ports, grown from `team-caller.pipeline.ts`.
- After conversion a refused staff caller costs two document reads. Today
  the token refuses them for free. At this size that is noise (Cost).

**Stage A's callables.**

| Callable             | Capability and target                                                                                       | Reads in    | Kept after `admit`                             |
| -------------------- | ----------------------------------------------------------------------------------------------------------- | ----------- | ---------------------------------------------- |
| `setRosterWeek`      | `HOURS`, the barber named                                                                                   | transaction | Record and shop checks of `RosterAccessSystem` |
| `amendRosterBreaks`  | `HOURS`, the barber named                                                                                   | transaction | The same                                       |
| `setDayExceptions`   | `TIME_OFF`, every barber named                                                                              | transaction | The same                                       |
| `staffAnalytics`     | `ANALYTICS`, by `scopeOf` (P3)                                                                              | port        | `ANALYTICS_BARBER_NOT_LINKED`                  |
| `setAnalyticsGoal`   | `ANALYTICS`, by `scopeOf` (P3)                                                                              | port        | The goal rule (`ANALYTICS_GOAL_FORBIDDEN`)     |
| `listTeam`           | `TEAM_MANAGE`: every row. `TEAM_PROFILES` or `TEAM_OFFERINGS` at everyone: barber records only, no accounts | transaction | —                                              |
| `addBarber`          | `TEAM_MANAGE`, shop                                                                                         | transaction | The team rules                                 |
| `editBarber`         | Profile part: `TEAM_PROFILES`, the barber named. Other parts: `TEAM_MANAGE`, shop                           | transaction | The record checks of `TeamSystem`              |
| `setBarberOfferings` | `TEAM_OFFERINGS`, the barber named                                                                          | transaction | The offering rules                             |
| `deleteDraftBarber`  | `TEAM_MANAGE`, shop                                                                                         | transaction | The draft rules                                |
| `activateBarber`     | The fixed staff tier                                                                                        | transaction | Its refusal becomes `ACCESS_NOT_STAFF`         |

**Effect.** A cell change applies to the next call. So does a role change,
for a converted callable.

**Errors.** One new file, `errors/access.error.ts`, with the dictionary
`AccessErrorCode`:

- `ACCESS_NOT_STAFF`, `ACCESS_DENIED { staffCapability }` and
  `ACCESS_OWN_ONLY { staffCapability }`, all answered as permission-denied.
- `staffCapability` joins `WIRE_PARAM_ALLOWLIST`, so the web can say which
  capability is missing. The words are one sentence per code with the
  capability's label (P10) set in.
- The dictionary gets its rows in the edge's tables (`EDGE_DICTIONARIES`,
  `EDGE_WIRE`).
- Each domain's `*_UNAUTHENTICATED` code stays for a call with no session.
- Retired in stage A: `SCHEDULING_ROSTER_FORBIDDEN`, `TEAM_FORBIDDEN` and
  `ANALYTICS_FORBIDDEN`. Kept: `ANALYTICS_BARBER_NOT_LINKED` (the analytics
  store shows its own empty state for it) and `ANALYTICS_GOAL_FORBIDDEN`.
  Stage B retires the staff edit's forbidden code and lists the booking
  ones it replaces.

**The fixed lists, by stage.** A list is deleted in the stage that converts
its last reader, the rules included.

| List                                                       | Readers                                                                                                           | Deleted in                                                  |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `ROSTERS`, `TEAM`, `TEAM_PROFILES`                         | Server only                                                                                                       | A                                                           |
| `ANALYTICS_SELF`, `ANALYTICS_SHOP`                         | Server (A); two routes, the session identity service, the dashboard's analytics entry and the analytics store (T) | T                                                           |
| `MONEY`                                                    | Billing and the dashboard's discount arm (B); the `users` list rule's parity twin (C)                             | C                                                           |
| `BOOK`                                                     | The booking wire (B); `worksTheBook()`'s parity twin                                                              | C, if `BOOKING_VIEW` enters; else it stays as the book tier |
| `SPEND`                                                    | The client card store, the `restricted` rule (C)                                                                  | C                                                           |
| `ALL`, `STAFF`, `ADMIN`, `PRIVACY`, `ASSIGN`, `ASSIGNABLE` | —                                                                                                                 | Stay                                                        |

**The editor's callable, `setStaffPermissions`.**

- **Request.** An `operationId` and a list `changes`, each entry a
  `staffCapability`, a `role` and an `accessScope`. At most one entry per
  cell; an entry names the scope
  the owner wants, never `null`.
- **Gate.** The wire asks `Roles.assignsRoles` on the token; the
  transaction then asks the stored account for an active `admin`, as
  `setRoles` does. App Check is limited-use, as for `setRoles`.
- **Refusals,** in `governance.error.ts` beside the roles ones:
  `GOVERNANCE_PERMISSIONS_UNAUTHENTICATED`,
  `GOVERNANCE_PERMISSIONS_FORBIDDEN`, `GOVERNANCE_PERMISSIONS_INVALID`
  with the `field` at fault (not a list, too long, an unknown capability,
  role or scope, a
  cell named twice) and `GOVERNANCE_PERMISSIONS_NOT_OFFERED` (a level that
  is not editable, "own" off the barber level or on a switch, a capability
  the level cannot use because of what it needs).
- **Write.** It reads the document in its transaction, applies the
  changes, stores `null` for each cell now equal to its default, and sets
  the whole body, stamped with the operation. A save that changes no cell
  writes nothing, which also makes a replay harmless.
- **Answer.** The cells that changed, each with its scope before and after.
- **Audit.** One row (P11).

### P7. Enforcement for what the browser reads

This part is conditional on the spike (stage S). It is written here so the
spike has something to test.

The rules would read the same document, so reads follow the owner's choices
without a new sign-in. Illustrative only; stage S proves the forms:

```text
function permissions() {
  return exists(/databases/$(database)/documents/settings/staffPermissions)
    ? get(/databases/$(database)/documents/settings/staffPermissions).data
    : {};
}
function cell(field, standard) {
  let stored = permissions().get(field, null);
  return stored == null ? standard : stored;
}
// One named helper per governed capability, one clause per level.
function mayClientSearch() {
  return hasAnyRole(['admin', 'sysadmin'])
    || (hasAnyRole(['barber']) && cell('barberClientSearchScope', 'ALL') == 'ALL')
    || (hasAnyRole(['receptionist']) && cell('receptionistClientSearchScope', 'ALL') == 'ALL')
    || (hasAnyRole(['content_manager']) && cell('contentManagerClientSearchScope', 'NONE') == 'ALL');
}
```

- A stored value the rule cannot read matches no scope, so it grants
  nothing, as the guard does (P5).
- **Cost, as read from the Firebase documentation.** A rule that reads a
  document is billed one read per request, however often the rule names
  it, and also when the request is refused. The owner and a client reading
  their own data are answered before the document is read. The limit is ten
  such reads per request. A Storage rule may read two Firestore documents.
- **When a change takes effect.** The next request sees a cell change.
  Whether an already open listener is cut is not documented. A role change
  still reaches the rules only when the token refreshes (R7).
- **The second copy of the defaults.** The `standard` arguments repeat
  `StaffPermissions.DEFAULT`. The rules-text reader of
  `role.rules-parity.spec.ts` reads only helpers made of role checks today,
  so stage C extends it to read each `cell('<field>', '<standard>')` pair
  and hold it equal to the code.

### P8. The web

- **One service.** `StaffAccessService` streams the document and answers
  `scopeOf(staffCapability)` and `mayFor(staffCapability, barberId)` as
  signals, by calling `StaffAccessSystem.scopeOf` and `admit`. The
  signed-in account comes from `AccountStateService`, which already holds
  the one live copy. It reads the stored account's roles, as the server
  does, and the token only until the account has loaded.
- **What the screens do with it.** Nobody: the entry point is not shown.
  Own: it is shown on the caller's own lane or record, and a colleague's is
  read-only. This is where the hours and block entry points on a
  colleague's lane get hidden.
- **Routes.** A route behind a capability is decided by
  `SessionAccessSystem` through a new `RouteGate` variant, which waits for
  the account and the document as `rolesGuard` waits for a settled
  session. It takes over the routes of the capabilities that exist: the
  analytics routes and the Team screen in stage T, `staff/schedule` when
  `BOOKING_VIEW` enters.
- **The existing gates move as their capability enters:** the analytics
  scope picker and entry (T); the manual discount arm (B); the client
  search and the client card's spend block (C). Until then each keeps
  today's role check.
- **One new port bundle** for the stream, typed against one
  `InjectionToken` (Law 9).

### P9. The owner as a barber

Built in stage 0 (PR #75).

- The model already allowed it: roles `barber` and `admin` on one account,
  linked to a barber record. The block was `GOVERNANCE_ROLES_SELF` on every
  self-change.
- **Decision:** `setRoles` admits a change to the caller's own account when
  the requested set still holds `admin`. Everything else in
  `RoleAssignmentSystem.decide` is unchanged: the link rules, the lock on
  the barber record, the assignable set.
- **The last-admin invariant still holds by construction.** After every
  admitted plan the caller is an admin. The property spec covers the self
  case.
- **Nobody is signed out.** A self-change skips the session revoke
  (`RoleAssignmentSystem.revokesSessions`). The caller's token keeps
  `admin`, which passes every gate that asks the token.
- **What the owner's open session shows.** The web reads roles from the
  token and the link from the stored account. So the owner's own lane works
  at once, and anything the web shows only to a token that holds `barber`
  appears after the next sign-in. Nothing an admin can already do is
  missing. Stage T's `StaffAccessService` reads the stored roles and
  removes the wait.
- **Where.** On the Team screen (stage T), a barber record with no linked
  account offers «Това съм аз» (this is me) to an admin. The record's page
  then offers «Не съм аз» (this is not me). The client card still does not
  offer «Роли» on the viewer's own account.
- This overturned the cut in team onboarding ("An admin linking their own
  account as a barber").

### P10. The screens

- **«Екип» (team) → «Права» (permissions).** A list of the editable
  levels. Each row names who holds the level and how far it departs from
  the standard («3 промени», three changes).
- **A level's page.** Rows grouped as in P2, only for the capabilities that
  exist (P13). On «Бръснар», an own-or-all capability is a value row with a
  menu: «Не · Само своите · Всички» (no, own only, everyone). On the other
  levels, and for a switch, it is a switch. A changed row is marked. A row
  whose needed capability is off is unavailable and says why. The bottom
  bar holds «Запази» (save). «Върни стандартните» (restore the standard) resets
  the level.
- **«Администратор».** One read-only line: everything, always.
- **A team member's page** links to the pages of the levels the person
  holds.
- Deferred: a per-person "what this person may do" summary and an undo on
  the save receipt. Neither changes the model.
- A design pass with a prototype comes first, with design-system elements
  only (stage T).

| Group   | Capability       | Row label                                                        |
| ------- | ---------------- | ---------------------------------------------------------------- |
| График  | `BOOKING_VIEW`   | Вижда графика (sees the schedule)                                |
| График  | `BOOKING_MANAGE` | Записва и променя часове (books and changes visits)              |
| График  | `TIME_OFF`       | Блокира време (blocks time)                                      |
| График  | `HOURS`          | Променя работното време (changes working hours)                  |
| Каса    | `BOOKING_MONEY`  | Дава отстъпка и променя цена (gives a discount, changes a price) |
| Клиенти | `CLIENT_SEARCH`  | Търси във всички клиенти (searches all clients)                  |
| Клиенти | `CLIENT_CONTACT` | Вижда телефон и имейл (sees phone and email)                     |
| Клиенти | `CLIENT_SPEND`   | Вижда похарченото от клиент (sees a client's spend)              |
| Анализи | `ANALYTICS`      | Вижда анализи (sees analytics)                                   |
| Екип    | `TEAM_PROFILES`  | Редактира профил на бръснар (edits a barber's profile)           |
| Екип    | `TEAM_OFFERINGS` | Определя услуги и цени (sets services and prices)                |
| Екип    | `TEAM_MANAGE`    | Управлява екипа (manages the team)                               |

### P11. Audit and measures

- **One row per save, credited to the caller:** `TEAM_PERMISSIONS_CHANGED`,
  with one element per changed cell (`staffCapability`, `role`,
  `accessScopeFrom`, `accessScopeTo`). Its resource is the settings
  document and its key is the operation id, not the instant, so two saves
  in one millisecond cannot collide. It lands in the save's own commit.
- **No second row.** `GovernedChangeSystem.auditedByCallable` admits only
  `barbers` and `services` today. Stage A adds a stamped write to
  `settings/staffPermissions`, so the settings trigger writes its generic
  row only for an unstamped write (the console, a script).
- **Refusals** are logged at the edge's outcome line with the error code
  and the capability, and no personal data. No pipeline's ports change. A
  rise in refusals for one capability after a change means the owner cut
  something people need.

### P12. What changes in stage A

| Area        | Files                                                                                                                                                                      | Change                                                                                                                 |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Primitives  | `staff-capability.data.ts`, `access-scope.data.ts`, `ids.primitive.ts`                                                                                                     | Added: the two tag dictionaries, the settings id                                                                       |
| Errors      | `access.error.ts`; `governance.error.ts`; `pipeline.error.ts`; `scheduling.error.ts`, `team.error.ts`, `analytics.error.ts`                                                | Added: the access codes, the editor's refusals, the allowlist row. Removed: three forbidden codes                      |
| Components  | `staff-permissions.data.ts`, `permissions-call.data.ts`; `audit-context.data.ts`; `roles.data.ts`                                                                          | Added: the cells, defaults, guard, call. Changed: the audit variant. Removed: three lists                              |
| Entities    | `staff-permissions-settings.entity.ts`                                                                                                                                     | Added                                                                                                                  |
| Systems     | `staff-access.system.ts`, a planner for the save; `roster-access.system.ts`, `team.system.ts`, `staff-analytics.system.ts`, `audit.system.ts`, `governed-change.system.ts` | Added: the two systems. Changed: caller checks replaced, `AnalyticsCaller` removed, the audit skip                     |
| Ports       | `callables.ts`; the settings read bundle                                                                                                                                   | Added: the callable's entries, `StaffPermissionsReadPorts`                                                             |
| Pipelines   | `set-staff-permissions.pipeline.ts`; `team-caller.pipeline.ts`; the three roster, six team and two analytics pipelines                                                     | Added: the save. Changed: the shared reader, each conversion                                                           |
| Functions   | `firestore-settings.adapter.ts`; `wire/{roster,team,analytics,governance,triggers}.wire.ts`; `edge.ts`; `main.ts`, `main.spec.ts`                                          | Changed: the read port, the wire gates, the capacity trigger's filter, the edge rows, the export and its pinned counts |
| Rules       | `firestore.rules` and its emulator spec; `firestore.indexes.json`                                                                                                          | Changed: the `settings` read, the `writeOperationId` override                                                          |
| Words       | `bg.json`, `en.json`; the analytics store's error switch                                                                                                                   | Added: the access and editor words, the capability labels. Changed: the retired codes                                  |
| Seed, tests | An integration helper that writes `settings/staffPermissions`                                                                                                              | Added. The dev seed writes no document: the defaults are code                                                          |

Names: the scope dictionary is `AccessScope` (field `accessScope`), not
"grant scope", because coupon grants already own that word. The capability
field is `staffCapability`, after its dictionary (Law 1).

### P13. A capability exists only once it is enforced

- The `StaffCapability` dictionary holds only the capabilities whose stage
  has shipped. Stage A adds six, B two, C up to four.
- So `setStaffPermissions` cannot name a capability that nothing enforces,
  the document has no field for it, and «Права» has no row for it. The
  screen is drawn from the dictionary, so it is written once and grows a
  row when a stage lands.
- Until its stage, a planned capability keeps today's fixed behaviour on
  the server, in the rules and in the web.
- This replaces the first draft's plan, in which all sixteen rows could be
  saved and shown while ten of them were still decided by the old lists.

## Cost

- **Acts.** Two more document reads per staff call, one where the account
  is already read. They join the transaction's first read step. Three
  hundred staff acts a day is six hundred reads, about a cent a month at
  list price. A refused staff call now costs two reads where the token
  refused it for free.
- **A permissions save.** One transaction and one audit row. With the
  capacity trigger filtered it rebuilds nothing; the audit trigger and the
  statistics recompute still start and exit.
- **Reads (stage C).** One more read per governed request by a staff
  member. A schedule that opens eight listeners costs eight reads more per
  opening.
- **Build.** A, T and B are each a large change. S is small. C is medium
  and depends on what S finds. M is small.

## Risks

- **R1. An open listener may outlive a narrowing.** Not documented for
  Firestore. Stage S measures it in the emulator, which is weaker evidence
  than production. Assumed bound: the web re-attaches its streams when the
  document changes, and a session that does not is cut when its token
  refreshes, within the hour. If the owner will not accept that hour, C
  does not ship the capability.
- **R2. The owner narrows too far and staff are stopped mid-day.** A change
  works both ways at once, the level's page shows who it affects, one tap
  resets a level, and refusals are counted (P11).
- **R3. The defaults exist twice from stage C,** in code and as the rules'
  `standard` arguments. The parity spec holds them equal (P7).
- **R4. Shared visits under own-only.** Mitigated by P3: either barber on a
  shared visit may act on it, so a shop with no front desk is not stuck.
  The cost is O4.
- **R5. The booking calls gain two reads on the busiest write path.** They
  join the first read step. Stage B's exit compares the path's latency
  before and after.
- **R6. A long screen.** Twelve rows in five groups, six at first. The
  defaults are usable untouched.
- **R7. A role change reaches rule-guarded reads only at token refresh.**
  This is today's behaviour and this design does not change it: the rules
  test the token's roles before they read a cell. `setRoles` revokes the
  session, and the web signs the person out within five minutes.
- **R8. A hand-edited bad value switches a level off for one capability**
  (O11). The owner keeps everything, sees the row in «Права», and one save
  repairs it.

## Open decisions (author's call, owner may overturn)

Each says which stage it must be settled before.

- **O1. The defaults keep today's behaviour,** so a barber may act on any
  visit until the owner narrows it. The alternative is to ship barbers at
  own-only for `BOOKING_MANAGE`, as Booksy and Square do for their lowest
  level. The author keeps today's behaviour because nothing should change
  on the day a stage ships. _Before B._
- **O2. A manager level is added, in stage M.** The alternative is to tick
  more boxes on «Рецепция», which makes every receptionist a manager.
  _Before M; it no longer holds up A._
- **O3. No exceptions for one person.** A senior barber who also books for
  others holds two levels. A per-person exception would need its own
  design. _Gates nothing._
- **O4. A visit is the caller's own when they are one of its barbers.** So
  a barber limited to their own visits may check in, change or cancel a
  party shared with a colleague, and may take over a colleague's seat on
  it. The alternative is seat by seat: only the caller's own seat, and the
  rest needs the front desk. The author chose the visit because the rules
  can only ever test "is on the visit", so reads and acts agree, and
  because a shop with no front desk would otherwise leave shared visits to
  the owner. _Before B._
- **O5. What the rules guard waits for a spike.** If hiding client contacts
  from barbers matters most to the owner, S looks at that first. _Before
  C._
- **O6. No owner-named levels.** The alternative needs a different stored
  shape and a `Role` that is not a closed dictionary. _Gates nothing._
- **O7. A manager cannot change roles or permissions.** Both stay with the
  owner, by the gate in P6. _Before M._
- **O8. `TEAM_OFFERINGS` may be given to a barber for their own prices.**
  Team onboarding listed "a barber setting their own prices" as a
  non-goal, and the code says "Prices are the owner's". The default keeps
  that: nobody but the owner. The cell exists because a shop where barbers
  rent a chair does let them price their own work, and the owner asked for
  everything to be gated. The alternative is a plain switch with no "own".
  _Before A._
- **O9. Notes and photos stay with whoever works the book.** Any of them
  may add a note or a photo to any visit they can read, and delete a
  photo, as today. The alternative ties those writes to `BOOKING_MANAGE`,
  which costs three document reads per write in the rules. Stage S
  revisits it if visits become own-only to read. _Before C._
- **O10. `CLIENT_SEARCH` defaults to yes for a barber.** Today a barber's
  search finds client records and silently skips registered accounts
  (G4). A barber needs the search to book a returning client, so the
  default gives both halves; this is the one default that widens what a
  level can do. The alternative keeps the accounts half for the front
  desk. _Before C._
- **O11. A stored value the system cannot read grants nothing.** The
  alternative falls back to the default, which would quietly give back
  what an owner had removed. _Before A._
- **O12. Four first-draft rows are gone.** A seat's price joins the
  discount as `BOOKING_MONEY` (one list and one predicate guard both, and
  no screen offers a price field). Content stays the «Съдържание» level.
  The loyalty programme stays with the owner. Opening a client's card
  follows working the book. Any of them can return as a capability later
  at no stored-data cost. _Before A (names) and B._

## Staging

Stage key: 0 the owner as a barber · A the engine · T the Team screen · B
the booking calls · S the spike for reads · C what the rules guard · M the
manager level. T, B and S each need only A and can run in any order; the
author builds T first because the Team screen has waited longest, and B
then adds two rows to «Права» with no screen change.

Every stage runs the repository's gate before it merges: the commands of
`CLAUDE.md` §5, plus `pnpm nx run functions:test-integration` under the
emulators and the rules emulator spec when the rules change.

### Stage 0. The owner as a barber (built, PR #75)

- **Built.** `setRoles` admits a self-change that keeps `admin`, with no
  session revoke.
- **Exit, met.** The pipeline and property specs; an emulator case that
  links an admin to a record, finds no session revoked, and checks on the
  stored account that analytics would admit the account's own scope.
- **Left.** The «Това съм аз» door (stage T). The analytics callable was
  not driven with the un-refreshed token; stage A's emulator case does.

### Stage A. The engine, and the calls that already judge the account (built, PR #78)

- **Depends on.** Nothing. O8 and O11 are settled as written.
- **Builds.** Everything in P12: six capabilities, the cells and defaults,
  `StaffAccessSystem`, the settings entity and its read rule, the eleven
  conversions of P6, `setStaffPermissions` with its audit row, the trigger
  filter. No web screen; the web gains only words.
- **Exit tests.**
  1. _Unit, characterization._ A frozen table of role set × link (none,
     own, another) × each stage-A act, taken from today's
     `RosterAccessSystem`, `TeamSystem` and `StaffAnalyticsSystem` before
     they change. `StaffAccessSystem` over the defaults answers the same.
  2. _Unit, the guard._ `StaffPermissions.read` never throws on arbitrary
     JSON, and answers the table of P5.
  3. _Unit, each converted pipeline._ No document equals the defaults; a
     narrowed level is refused; own-only on a colleague is refused; a
     widened level is admitted.
  4. _Unit, the editor._ Each refusal of P6; a no-change save writes
     nothing; the body is whole; a default cell is stored as `null`.
  5. _Emulator, through the callable edge._ A content manager's token
     given `TEAM_MANAGE` gets `listTeam`. A receptionist narrowed on
     `HOURS` is refused on the next `setRosterWeek` with the same token. A
     hand-written bad cell refuses that level and still admits the admin.
     One save writes one `TEAM_PERMISSIONS_CHANGED` row and no trigger row,
     and starts no capacity rebuild. An admin linked as a barber reads
     their own analytics with a token that lacks `barber`.
  6. _Rules emulator._ `settings/staffPermissions`: anonymous and client
     refused, a barber allowed, an absent document readable by staff;
     `settings/bookingPolicy` still public.
- **Leaves.** The web still gates analytics on the token's roles until T.
  Nobody can edit a cell without a script until T.
- **Built, and where it differs from the text above.**
  - _The target's name._ `AccessTarget` was already the route guard's
    redirect, so the act's target is the component `StaffTarget`
    (`staffReach`: `BARBERS` or `SHOP`) and `admit` takes `staffTarget`.
  - _The "needs" rule is not in the code yet._ None of the six
    capabilities of this stage needs another, so there was nothing to
    clamp or test. It enters with `BOOKING_MONEY` in stage B. Until then
    `GOVERNANCE_PERMISSIONS_NOT_OFFERED` covers a level the owner does not
    edit and "own" where the cell does not offer it.
  - _The words._ One sentence per code and capability
    (`errors.ACCESS_DENIED.HOURS`), read one level deeper as a field or a
    refusal already is, with the code's own sentence as the fallback. A
    label set into one sentence read badly in Bulgarian. The row labels of
    P10 are in the catalogue too (`staff.permissions.capabilities`).
  - _The Team list for an editor of every barber's page._ The accounts are
    not read at all, so those rows carry no "no account" note: it would be
    a guess.
  - _The wire gate now admits the content editor's token_ on the roster
    calls, because the owner may give that level hours. The stored account
    still decides.
  - _The frozen table_ is a data file beside its spec
    (`staff-access.characterization.json`), taken from the systems as they
    were on `main` before any check changed: 64 role sets, and both links
    for the 32 that hold `barber`. A link with no barber role is left out,
    because no call can write that state; the old profile check admitted
    it and the new one does not.

### Stage T. The Team screen, with «Права»

This is the screen half of team onboarding stage 1a ("The Team page and the
editors"); its server half is merged.

- **Depends on.** A.
- **Prototype (built).** The showcase's «Team» composition
  (`apps/showcase/src/app/pages/compositions/team`): the team list as the
  owner and as a content editor see it, a member in preparation with «Това
  съм аз», a member taking bookings, the add sheet, «Права» and two level
  pages. The level pages read and write the real cells
  (`StaffPermissions`), so their rows, standards and counts are the
  engine's. What it settled: a changed row carries one orange dot and says
  what the standard was; «Запази» is in the dock only while the draft
  differs; a level's row on «Права» counts its changes; going live has no
  button.
- **Builds.** A prototype pass first. Then `StaffAccessService`, the route
  gate, the Team page and its editors, «Права» for the capabilities that
  exist, the «Това съм аз» door, and the web gates of stage A's
  capabilities (hours and block entry points hidden on a colleague's lane,
  the analytics entry and scope picker). `ANALYTICS_SELF` and
  `ANALYTICS_SHOP` are deleted.
- **Exit tests.** _Unit:_ the service's signals over a fake stream; the
  presenters' words. _End to end:_ an owner narrows «Рецепция» on hours,
  and a front-desk session loses the entry point without signing in again
  and is refused if it calls anyway; an owner links themself to a record
  and sees their own lane; a content manager reaches a barber's profile
  from the Team list and sees no accounts.
- **Leaves.** Rows for B's and C's capabilities.
- **Built so far: the access service and the route gate.**
  `StaffAccessService` (beside `AccountStateService`) holds the session's
  one live copy of the cells (`STAFF_PERMISSIONS_PORTS`, one bundle, one
  token) and answers `scopeOf`, `accessOf` and `mayFor`. The route gate is
  `RouteGate.Capability`, decided by `SessionAccessSystem`; `capabilityGuard`
  waits for the stored account and the cells. The analytics routes, the
  menu's row, the schedule's chart button and the scope picker follow the
  `ANALYTICS` capability, and `ANALYTICS_SELF`, `ANALYTICS_SHOP` and
  `Roles.readsAnalytics` are deleted. Where it differs from P8:
  - `mayFor` asks a new pure rule, `StaffAccessSystem.reaches`, not
    `admit`: a screen asks before the account has loaded and has no clock
    to read a block by. A spec holds the two to the same answer for every
    level, capability and barber.
  - Nothing is granted on a half-read session. Until the account and the
    cells have answered, every reach is nobody, so an entry point appears
    only once the decision behind it is final; P8 read the token until the
    account loaded. A tap must never start a navigation its gate has to
    wait on: the page being left syncs its own URL meanwhile, which cancels
    the pending navigation. The end-to-end suite caught exactly that on the
    schedule's chart button.
  - The owner needs no cells. The admin's everything is answered before a
    cell is read (P4), so an admin's session is settled once the account
    has answered. When the cells cannot be read, every cell is nobody.
  - The schedule's chart button is now hidden from a session that reads no
    analytics. It used to be shown to everyone, and led the front desk to the
    forbidden page.
- **Built so far: the schedule's gates.** `ScheduleAccess` (beside the
  schedule page) asks the service what each entry point needs: `TIME_OFF`
  for blocked time and a day's own breaks, `HOURS` for a chair's weekly
  hours and its roster breaks.
  - The ＋ offers «Блокирай време» and «Работно време» only to someone who
    may do them on some chair; a slot or a free-time row asks for its own
    chair. From the ＋, and from a date's all-day band, a block lands on a
    chair the person may block.
  - The hours sheet and the block editor list only the chairs the person
    may change.
  - A colleague's block and break open nothing and lift nothing. The grid
    draws them as unavailable and keeps them named for a reader; the list's
    row loses its press and its focus stop; the all-day band and a day-off
    chip on a colleague's chair are pictures.
  - A break's question offers only what the person may do: «Само този ден»
    is `TIME_OFF`, «Този и следващите» is `HOURS`.
  - The visit sheet's «Откажи и блокирай времето» is offered only where the
    chair's time is the person's to block.
  - Left as it is: «Без край» on the block sheet writes a weekly break, so
    it asks `HOURS`. Someone with `TIME_OFF` alone still sees the choice
    and gets the server's worded refusal on save.
- **Built so far: the Team list and «Права».** A library of its own
  (`libs/features/admin/team`) and three routes: `/admin/team`,
  `/admin/team/permissions` and `/admin/team/permissions/:level`.
  - Who gets in. The Team list opens for anyone one of the team's three
    capabilities reaches everyone for (`RouteCapabilities.Team`:
    `TEAM_MANAGE`, `TEAM_PROFILES` or `TEAM_OFFERINGS`), which is the
    question `listTeam` asks. «Права» is the owner's alone (`Roles.ASSIGN`),
    as `setStaffPermissions` is. The menu's «Екип» row and the list's
    «Права» row ask the same two rules (`StaffAccessService.opens`,
    `editsPermissions`), so neither leads to the forbidden page.
  - The list reads `listTeam` on each visit (`TeamStore`). Its runs are
    `TeamRosterSystem.sectionsOf`: the barbers who have not left, the
    accounts with a staff role and no record, and those who left. A row
    words how the record stands, a draft's progress and its one note.
    Someone without `TEAM_MANAGE` gets the records alone from the server,
    and a lede that says so. The rows open nothing yet: the member page is
    the next slice.
  - «Права» keeps one draft for all levels (`PermissionsStore`): the
    answers the owner wants, which `StaffPermissionsEditSystem.plan` turns
    into the changes to send. An answer put back by hand therefore leaves
    the draft clean, and «Запази» leaves the dock. A level's row names who
    holds it (`TeamRosterSystem.holdersOf`) and counts how far it departs
    from the standard (`StaffPermissions.departuresOf`). A level's page
    lists its rows in three groups (`StaffPermissions.GROUPS`): a cell with
    two answers is a switch, one with three is a menu. «Запази» sends the
    whole draft in one call; «Върни стандартните» drafts the standard for
    one level.
  - Everyone else's session follows at once. The end-to-end case has the
    owner switch off the front desk's hours while a front-desk session has
    the ＋ open: «Работно време» leaves that menu with no reload, and comes
    back when the owner restores the standard. That the same session's call
    is refused is the emulator suite's case (`staff-permissions`
    integration spec). A second case holds that a content editor sees the
    records and no accounts and is turned away from «Права», and that a
    barber is turned away from the list.
- **Built so far: the member's page, the add sheet and «Това съм аз».**
  `/admin/team/member/:barberId`, for the people the list opens for. A
  barber record's row on the list leads to it.
  - The page reads the record off the staff's team stream and asks
    `StaffSetupSystem.checklistOf` over the live record, services and
    roster, so a save made anywhere redraws it. In preparation, what
    bookings need leads the page; at work, the same rows are at rest under
    «Профил». A leaver's page is read.
  - Each editor is one `editBarber` part: «Име и описание» (`PROFILE`, a
    sheet, the English under «Превод (по желание)»), «Период на работа»
    (`PERIOD`, a sheet with the design system's month), «Приема „Който и
    да е“» (`POOL`, a switch) and «Кой може да записва» (`ACCESS`, a
    menu). A sheet offers «Запази» only when `TeamSystem` would take the
    draft, which is the rule the server asks. What a person may change is
    asked row by row: `TEAM_PROFILES` for the profile, `TEAM_MANAGE` for
    the rest.
  - Going live has no button. The page's store asks `activateBarber` once
    when a record in preparation shows every needed item done, on reads
    that have answered, and the page then says «… вече приема записи».
  - «Изтрий» is offered where `TeamSystem.removable` allows, behind a
    question.
  - The add sheet (the list's ＋, for `TEAM_MANAGE`) takes a name, a start
    day and «Копирай цените от». It calls `addBarber`, then
    `setBarberOfferings` with `COPY`. The record gets a barber's defaults:
    every shop, public once live, in the pool. A copy that fails leaves
    the record there and is retried alone, so «Добави» never adds a second
    person.
  - «Това съм аз» · «Не съм аз» (P9). `TeamRosterSystem.claimOf` decides
    what the record is to the person looking, and
    `RoleAssignmentSystem.recordLinkOf` answers the roles and the link
    `setRoles` is sent. The page follows the stored account, so the row
    turns at once and nobody is signed out.
  - A member's page leads to the «Права» page of each level the linked
    account holds (P10).
  - The end-to-end case has an owner add a barber with a colleague's
    prices, save a title, flip the pool, take the record as their own,
    give it back and delete it, checking the stored record, account and
    lock at each step. A second case has a content editor reach a barber's
    profile from the list and find no account, no period editor and no
    delete.
- **Built so far: the hours from the member's page.** The weekly hours
  are the schedule's own sheet, not a second editor.
  - The sheet asks its host for four things (`HOURS_DESK`: a chair's
    roster, the week's save, and how that save stands). On the schedule the
    host is `StaffDayStore`; on a member's page it is that page's store,
    which calls `setRosterWeek` the same way. The sheet and its seam have
    entries of their own (`…/staff/dashboard/hours` and `…/hours-desk`), so
    the member's page loads the sheet when it is first asked for and never
    loads the schedule.
  - The row is a way in for anyone `HOURS` reaches the record for: the
    owner and the front desk by the standard, never a content editor.
  - A record in preparation can now be finished from its own page. With a
    colleague's prices copied and a week saved, it goes live by itself and
    `/book` offers it.
  - The end-to-end case adds a record with no prices, sets Monday from the
    page and reads the stored roster. It keeps the record in preparation
    on purpose: a fourth chair at work would be seen by every other spec
    running beside it. Going live is held by the unit specs and the
    emulator suite (`team-barber` integration spec), and was walked once
    in a browser by hand, through to times on `/book`.
- **Built so far: the services and prices editor.** «Услуги и цени» on a
  member's page, for anyone `TEAM_OFFERINGS` reaches the record for (the
  owner alone by the standard).
  - The sheet lists the catalogue's services, each with what the barber
    charges or «Не извършва». A row opens the service's own page: a switch
    for whether they perform it, their price and time, and each variant's
    when the service declares variants. It is the weekly hours sheet's
    grammar: a list of rows, a page per row, «Готово» back to the list.
  - A service switched on starts at the catalogue's own terms
    (`OfferingEditSystem.entryFor`). A price or a time typed goes through
    `OfferingEditSystem.withTerms`, which keeps the list sparse as the
    stored one is: a variant put back to the base holds no override, and a
    variant that followed the base goes on following it.
  - «Запази» sends the whole list as one `setBarberOfferings` `SET`. It is
    offered only when `OfferingEditSystem.plan` takes the draft and answers
    at least one change, which is the rule the server asks.
  - The setup and clean-up minutes of an offering are kept as they are and
    not edited here.
  - Both this sheet and the hours sheet load when first asked for, so the
    Team route stays inside its budget (1.50 MB of 1.55 MB).
  - The end-to-end case switches one service on for a new record, reprices
    it, and reads the offering on the stored service; «Изтрий» then takes
    the offering with the record.
- **Built so far: the shops editor.** «Салони» on a member's page, for
  whoever `TEAM_MANAGE` reaches the record for; a one-shop business has no
  row.
  - «Всички салони» is a switch of its own, because the stored empty list
    means every shop, including one added later. Off, each shop is a tick.
    A record that works everywhere starts with every shop ticked, so one
    press is the whole edit.
  - A shop the roster still has hours at keeps its tick and says why
    (`TeamSystem.rosteredShops`, the list `setShops` refuses over). The
    owner changes the hours first.
  - «Запази» is offered only when `TeamSystem.setShops` takes the draft and
    `LocationScopeSystem.sameScope` says it changes something. With no shop
    ticked there is no save.
- **Built so far: «Свържи профил» and «Разкачи профила».** Someone else's
  account, linked to a record from its page and released from it, by the
  owner alone (`setRoles` is theirs).
  - Who sees which door is `TeamRosterSystem.linksAccount` and
    `releasesAccount`: a record nobody is linked to offers the link; a
    record someone else holds offers the release. The owner's own account
    keeps «Това съм аз» · «Не съм аз», which sign nobody out.
  - The sheet opens on the team's own accounts that have no record
    (`TeamRosterSystem.unlinkedOf`). Typing looks the accounts up the way
    the schedule's client search does (`ClientQuerySystem`, the `users`
    index): a name, a phone or an email. Who of the answer is offered is
    `RoleAssignmentSystem.linkCandidatesOf`: registered, not erased, not
    blocked, no `sysadmin`, not the owner, and linked to no record yet. A
    link moves by being released first, never by being taken over.
  - A row asks before it acts, and says the person will have to sign in
    again. `RoleAssignmentSystem.recordLinkOf` answers what `setRoles` is
    sent, for the owner's own account and anyone else's: the stored roles
    plus `barber` and the link, or without `barber` and the link cleared.
    An account left with no role is a `client` again.
  - A change the server wrote without ending the person's sessions
    (`GOVERNANCE_ROLES_SESSIONS_NOT_REVOKED`) counts as written. The page
    says so in a notice with «Опитай пак», which sends the same change
    again: nothing is written twice and the sessions are ended. This is the
    client card's retry.
  - Where it differs from team onboarding D8: the lookup is by name, phone
    or email in one field, not by an email check on the add sheet. That
    check (`checkStaffInviteEmail`) comes with the invites.
  - The end-to-end case moves a new record to one shop, links a seeded
    client found by family name, checks the stored roles, link and lock,
    releases it and checks them again.
- **Built so far: a staff account's page.** `/admin/team/account/:userId`,
  for an account that holds a staff role and is linked to no barber record:
  the front desk, a content editor, an admin. Its row on the Team list
  leads to it.
  - The page shows who it is, the staff roles as ticks, the way to «Права»
    for each level held (P10), and «Махни от екипа» behind a question.
  - What the page is to the person looking is
    `TeamRosterSystem.accountStandingOf`: the owner changes someone else's
    account; their own, the vendor's, an unregistered person's, and any
    account to someone who assigns no roles are read, each with one line
    that says why.
  - The ticks are «Рецепция», «Съдържание» and «Администратор»
    (`RoleAssignmentSystem.teamTicksOf`). «Бръснар» is a tick only while
    the account holds it: the page can take it away, and it is given from a
    barber's page with «Свържи профил», because `setRoles` wants a record.
  - The ticks are a draft. «Запази» is in the dock only while
    `RoleAssignmentSystem.teamSaveOf` would send them: at least one tick,
    and a set that differs from the stored one. `teamRolesOf` answers the
    set: what the account holds beside the ticks (`client`) plus the ticked
    roles. With no tick there is no save; the account leaves the team by
    «Махни от екипа», which sends it as a `client`.
  - Every change ends that person's sessions, and the page says so under
    the ticks. A change written without ending them is said with «Опитай
    пак», as on a barber's page. Both pages send through one
    `TeamRolesStore`.
  - Adding someone who is no barber came later: see «Добави в екипа»
    below.
  - The end-to-end case opens a seeded front-desk account from the list,
    adds «Съдържание», reads the stored roles, and takes the account off
    the team. A second case holds that the owner's own account is read.
- **Built so far: the barber's photo.** A barber has ONE photo
  (`docs/architecture/decisions/2026-11-15-one-photo-per-barber.md`, the
  owner's ruling of 2026-11-15): it is kept on the record, and the server
  copies it to the linked account's avatar, so the two cannot drift.
  - On a member's page, whoever `TEAM_PROFILES` reaches the record for
    finds «Добави снимка» or «Смени снимката» under the head: the barber
    themself, a content editor, the owner.
  - The browser sizes the picture, stages it under the signed-in account
    (`pending/{uid}/{name}`: a staff token, its own folder, an image
    under 5 MiB, no reads) and calls `setBarberPhoto` with the file's name.
    The bytes never ride the call.
  - The call asks who may before it touches an object; checks the staged
    object; copies it to `media/barbers/{id}/{operationId}`; writes the
    record's `avatarMedia*` beside one `TEAM_BARBER_PHOTO_CHANGED` row; then
    copies the picture to the linked account's avatar, and deletes the
    staged file and the photo it replaced. A replay names the same object
    and answers at once.
  - `media/` lost its `list` permission: a record in preparation is
    staff-only, and its photo's name must not be found by listing.
  - The end-to-end case picks a picture in the browser for a new record
    with a linked account, and reads the stored reference, the object under
    `media/` and the account's avatar object.
- **Built so far: the account side of the one photo** (decisions F6 and F7
  of the same record).
  - **On linking (F6).** `setRoles` runs `reconcileBarberPhoto` after the
    link's commit. A record with a photo gives it to the account: the
    server copies it over `avatars/{uid}/original`. A record with none
    takes the account's avatar, in one commit with its own
    `TEAM_BARBER_PHOTO_CHANGED` row credited to whoever made the link. A
    failure is logged and never undoes the link.
  - The record takes an avatar only when its pixel size is known. The
    browser's avatar upload now downscales the picture and writes
    `mediaWidth` and `mediaHeight` as custom metadata; the server reads
    them and opens no file.
  - **The barber's own picker (F7).** On `/account/profile` a linked
    barber has one control, the picker, and a line saying clients see the
    photo. A pick runs `changeBarberPhoto` for their own record. There is
    no «Премахни снимката». When the owner's permissions do not let the
    barber edit their profile, the page says the shop manages the photo.
  - `storage.rules` refuses a create, an update and a delete under
    `avatars/{uid}/` to an account whose stored `linkedBarberId` is set.
  - Each Team screen loads on its own entry (`permissions.route.ts`,
    `member.route.ts`, `account.route.ts`), so the member page stays under
    its bundle ceiling: 1.48 MB of 1.55 MB.
  - The end-to-end case: a client adds a photo on their account page, the
    owner links them to a new record, the record holds a copy of that
    photo, and a pick on the barber's account page then replaces the
    record's photo and deletes the one it replaced.
- **Built so far: «Добави в екипа», a role for a registered account.** The
  front desk, a content editor and an admin are accounts with a role, not
  barber records. The Team page's ＋ now adds them too.
  - The ＋ is a menu for the owner: «Бръснар», «Рецепция», «Съдържание»,
    «Администратор». `RoleAssignmentSystem.teamAddOffersOf` says which are
    offered: a barber record to whoever manages the team, the three roles
    to whoever assigns roles. Someone offered only one thing gets no menu;
    the press opens it.
  - A role opens a lookup sheet. Before anything is typed it lists the
    team's own people who do not hold the role
    (`TeamRosterSystem.additionCandidatesOf`): a barber somebody signs in
    as, or a colleague under another role. A lookup by name, phone or
    email answers registered accounts
    (`RoleAssignmentSystem.additionCandidatesOf`).
  - Nobody is offered who could not take the role, or would gain nothing
    by it: the viewer, the vendor, an erased, unregistered or blocked
    account, a leaver, one that holds the role already, and an admin, who
    already does everything a role gives.
  - A row asks first («Да дам ли на … роля „Рецепция“?») and says the
    person will sign in again. For «Администратор» it also says what an
    admin may do.
  - The call is `setRoles` with `RoleAssignmentSystem.additionOf`: the role
    beside whatever the account holds, the barber link left as it is. So
    a barber can also run the front desk, and keeps the chair.
  - When it lands, the Team list is read again and the person's page
    opens: the account's page, or the barber's for an account linked to a
    record. A change written without ending the person's sessions is said
    on the list with «Опитай пак», and no page opens.
  - The person must have an account first. There are still no invites: a
    newcomer signs in to the app once, and the owner then finds them here.
  - «Свържи профил» and this sheet are one component,
    `lib-account-pick-sheet`; each brings its own rules and words.
  - The end-to-end case gives a registered client the front desk from the
    ＋, reads the stored roles and the audit row, and finds the account's
    page open.
- **Stage T is built.** What is left of the team's onboarding is in
  `docs/designs/team-onboarding.md`: the invites (email, per the owner's
  ruling) and the rest of the leaving stage. The close itself is built
  (stage 1b there): a barber whose last working day has passed leaves the
  team, and the linked account loses its staff access.

### Stage B. The booking calls

- **Depends on.** A. O1 and O4 are settled as written.
- **Builds.** `BOOKING_MANAGE` and `BOOKING_MONEY`; the visit target; the
  caller's uid added to the five booking commands, which carry the actor
  and its roles today and no uid; the per-call rule of P3; the staff edit's and the booking calls'
  forbidden codes replaced; a stored-account check on the impersonation
  calls and `publishStreakDefinition` (G2). The manual discount arm moves
  to `StaffAccessService` if T has shipped.
- **Exit tests.** _Unit:_ the P3 table, one case per row, and the batch
  rule for `staffEditAppointment` over every edit command. _Emulator:_ a
  barber narrowed to their own visits is refused on a colleague's visit
  with the same token, may check in a shared visit, and cannot add a seat
  for a colleague; a barber's crafted price change is refused on the stored
  account; an account whose role was just removed is refused on the next
  call. _End to end:_ the booking suite stays green with a seeded staff
  account. _Measure:_ the commit path's latency before and after (R5).
- **Leaves.** Reads still follow `worksTheBook()`.

### Stage S. The spike for reads

- **Depends on.** A. It writes no production code and can run beside T or
  B.
- **Answers,** each with evidence from the rules emulator:
  1. Are the helper's forms valid (`exists`, `get`, an empty map, `get`
     with a default, `let`), and what is billed per request?
  2. Is an open listener cut when the document changes (R1)?
  3. Can `BOOKING_VIEW` be own-only? The rule must know the caller's
     barber, and every staff reader of `appointments` must prove it returns
     only that barber's visits: the day query (`busyKeys array-contains`),
     the single visit, the client history page and the search window.
     Notes carry no barber. A photo's Storage rule would need three
     Firestore reads against a limit of two.
  4. Can `CLIENT_CONTACT` be hidden? The phone and email sit on the visit,
     on the client record and on `users/{uid}`; a rule cannot hide a field,
     so they would move to a restricted sibling and every reader changes.
  5. What must the rules-text reader learn to hold the defaults equal
     (R3)?
- **Exit.** A written go or no-go per capability, added to this brief:
  whether `BOOKING_VIEW` enters as a switch, as own-or-all, or not at all;
  whether `CLIENT_CONTACT` enters.

### Stage C. What the rules guard

- **Depends on.** S and B. O5, O9 and O10 are settled as written.
- **Builds.** `CLIENT_SEARCH` (list on both collections, with get split
  from list on `customers`) and `CLIENT_SPEND`; `BOOKING_VIEW` and
  `CLIENT_CONTACT` as S decided; the rules helpers; the parity reader's
  extension; the web gates for the search, the spend block and the
  schedule route. `MONEY` and `SPEND` are deleted, and `BOOK` if
  `BOOKING_VIEW` entered.
- **Exit tests.** _Rules emulator:_ for each capability, a level at its
  default, narrowed and widened, and a bad stored value granting nothing;
  the owner admitted with no document read. _Unit:_ parity of every
  `standard` argument with the code. _End to end:_ a barber with the search
  switched off sees no search and is refused if they query anyway.
- **Leaves.** Whatever S ruled out, recorded as not built.

### Stage M. The manager level

- **Depends on.** B, so the callable side has no fixed list left to join.
  O2 and O7 are settled as written.
- **Builds.** `Role.Manager` in the dictionary, `Roles.STAFF` and
  `Roles.ASSIGNABLE`; its column of cells and defaults (everything but a
  client's spend); the words. Every rules list that is still fixed when M
  ships gets `manager` by hand: `isStaff()`, `worksTheBook()` in both
  rules files, and, if C has not shipped, the `users` list rule and
  `isCatalogManager()`. The parity spec is extended to `storage.rules`.
- **Deploy order.** Rules, then functions, then web, so `setRoles` cannot
  mint a `manager` token the rules do not know.
- **Exit tests.** _Unit:_ the manager's defaults; `setRoles` assigns and
  removes the level. _Rules emulator:_ a manager token reads what the book
  tier reads. _End to end:_ a manager adds a barber and cannot open
  «Роли» or «Права».

## Review record

Round 1, 2026-11-14. Six reviewers; the report is
`docs/designs/staff-permissions-review/goldfish_review_round1.md`.

| Finding | Where it went                                                                                                                         |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| B1      | P5: one value per level and capability. Alternatives records the rejected role lists.                                                 |
| B2      | P13: a capability exists only once it is enforced. Stages re-cut.                                                                     |
| M1      | P5: the guard table, the same answers in the rules, fail closed (O11).                                                                |
| M2      | P5: the document is the entity, every field present, `null` for the default; the index override.                                      |
| M3      | Fact 3 and P6: reads in the transaction where one exists, a read port for analytics, two reader functions.                            |
| M4      | P5, P11, P12: the capacity trigger filter, the audit skip, the staff-only read rule, all in stage A.                                  |
| M5      | P3 and P6: explicit targets; a call naming no barber is a shop target; analytics asks the scope only and keeps the goal rule.         |
| M6      | P6: the signatures, the decision table, what "converted" means; P3: a barber who has left.                                            |
| M7      | P6: three access codes, the wire allowlist, what retires and what stays, the eleven-callable table.                                   |
| M8      | P6: the editor's request, gate, refusals, write, answer; P11: the audit row and its key.                                              |
| M9      | P6: both token gates named, the early read, the cost of a refused call.                                                               |
| M10     | P6: the lists by stage; P7: the parity reader's extension.                                                                            |
| M11     | Stage A: six named exit tests with their level.                                                                                       |
| M12     | Stage M: after B, its fixed memberships, deploy order, parity for `storage.rules`. P5 removes the stored-data cost of adding it late. |
| M13     | P2: the "needs" rule, the fixed book tier for the client's card, notes and photos (O9), the loyalty history, `listTeam`'s admission.  |
| M14     | G4 and O10: the search covers both collections; the barber default is a named widening.                                               |
| M15     | P3 and O4: a visit is own when the caller is one of its barbers; the per-call table; the caller's uid (stage B).                      |
| M16     | P1 and P3: own-only is offered on the barber level alone.                                                                             |
| M17     | P2 and O12: twelve rows. Alternatives weighs the two cheaper shapes; P7 is conditional on the spike.                                  |
| M18     | Stage S, with the reviewers' list of what the spike must cover; `BOOKING_VIEW` and `CLIENT_CONTACT` enter only on a go.               |
| M19     | P2: the defaults table with the `sysadmin` column and today's source.                                                                 |
| M20     | P12: stage A by area, file and change.                                                                                                |
| M21     | Stage T: its id, its place in team onboarding, its exit tests; the prototype pass is in the stage.                                    |
| M22     | Staging: one template per stage, with dependencies, exit tests and what is left.                                                      |
| M23     | The gap table: status, closing stage and residual for G1 to G4; the impersonation calls join stage B.                                 |
| M24     | O8: the overturned non-goal is named.                                                                                                 |

Nits: N1 to N8, N10, N12 to N16, N18 to N25 are applied in the text (tense
and date, `client` is not a level, fact 1, the profile photo, the
`sysadmin` wording, what the web reads, the schedule route, the link
exception, the cost lines, the names `AccessScope` and `staffCapability`,
the reuse of `team-caller.pipeline.ts`, `AccountStateService` and
`RouteGate`, the deferred screens, stage 0's criterion, the decisions tied
to stages, the glossary, the headings, the stage key, the table columns,
the client-facing callables). N9 is R1 and R7. N11 and N17 are stage S and
the gate line under Staging.

Not taken: prefixing this document's ids (N21). Code already cites "staff
permissions P9", so the ids stay and the header says they are this
document's own.

## Sources

Vendor help pages, read 2026-11-13:

- Fresha: <https://www.fresha.com/help-center/knowledge-base/team/100687-create-permission-roles>,
  <https://www.fresha.com/help-center/knowledge-base/team/100692-manage-permission-roles>,
  <https://www.fresha.com/help-center/knowledge-base/workspace-settings/100665-transfer-workspace-ownership-access-1>
- Booksy: <https://support.booksy.com/hc/en-us/articles/16535688940946-How-do-I-manage-staff-permissions>
- Square: <https://squareup.com/help/us/en/article/5822-employee-permissions>,
  <https://squareup.com/help/us/en/article/6372>
- Vagaro: <https://support.vagaro.com/hc/en-us/articles/18977275541531-Configure-Access-Levels-and-Employee-Permissions>

Firebase documentation, read 2026-11-13:

- <https://firebase.google.com/docs/firestore/pricing>,
  <https://firebase.google.com/docs/firestore/security/rules-conditions>,
  <https://firebase.google.com/docs/storage/security/rules-conditions>
