# Staff permissions: the owner decides who may do what

- **Author:** Dimitar Dimitrov (owner), drafted with Claude
- **Date:** 2026-11-13
- **Stage:** Design brief for the owner's review. It is written before the
  Team screen (team onboarding slice 5) so that screen is built once. The
  owner delegated the decisions; each one is the author's call and the owner
  may overturn any of them (the open ones are listed under "Open
  decisions"). It has not been through a Goldfish review round.
- **Builds on:** `docs/designs/team-onboarding.md`. Its D5 fixed the
  permissions in code; this brief makes them the owner's to set.

## Overview

The owner asked for two things:

1. The shop owner can also be a barber.
2. The owner decides who is allowed to do what: book for a colleague, see a
   colleague's schedule, block time for them, and so on, as Fresha and
   similar products allow.

**What exists today.** An account holds a set of roles (`barber`,
`receptionist`, `content_manager`, `admin`, and the vendor's `sysadmin`).
What each role may do is a fixed list in code (`Roles.*`,
`libs/ecs-core/src/components/roles.data.ts`), repeated in
`firestore.rules`. Changing any of it takes a release. The data model
already lets one account be `barber` and `admin` together, linked to a
barber record. What stops a sole owner is that `setRoles` refuses a change
to the caller's own account.

**What this design adds.**

1. A closed list of sixteen **capabilities**. Each is one thing a staff
   member may do or see.
2. **Levels.** They are today's roles, plus a new «Управител» (manager). The
   owner sets which capabilities each level grants.
3. A **scope** on every capability that concerns one barber's work: nobody,
   own only, or everyone.
4. One settings document that holds the owner's changes. The defaults stay
   in code and reproduce today's behaviour.
5. **Enforcement on the server**, on the stored account, inside each call's
   transaction. The security rules read the same document for what the
   browser reads directly.
6. A «Права» screen for the owner, and a "what this person may do" summary
   on each team member.
7. **The owner as a barber.** An admin may link their own account to a
   barber record.

### Words used in this brief

| Word       | Meaning                                                                                                      |
| ---------- | ------------------------------------------------------------------------------------------------------------ |
| Capability | One thing a staff account may do or see, from a closed list (P2).                                            |
| Level      | A role an account holds. An account may hold several and gets the widest grant among them.                   |
| Grant      | A level having a capability, with a scope.                                                                   |
| Scope      | `NONE`, `OWN` or `ALL`. Capabilities that are not about one barber's work have only `NONE` and `ALL`.        |
| Own        | The barber record the caller's stored account is linked to (`users/{uid}.linkedBarberId`).                   |
| Owner      | An account that holds `admin`. There may be more than one.                                                   |
| Act        | A change made through a callable.                                                                            |
| Read       | Data the browser reads straight from Firestore or Storage, guarded by the security rules.                    |
| Token      | The signed-in session's ID token. It carries the `roles` claim the rules and the callables' first gate read. |

## Analysis

### How access is decided today

Three layers decide, and each holds its own copy of the lists.

| Layer          | What it reads                                                                                 | Where                                                                                                                 |
| -------------- | --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Security rules | The token's `roles` claim and nothing else                                                    | `firestore.rules` helpers `isStaff()`, `worksTheBook()`, `isCatalogManager()`, `isAdmin()`, and two inline role lists |
| Callables      | The token's roles at the wire. Some then re-read the stored account inside their transaction  | `apps/functions/src/wire/*.wire.ts`, then the pipelines and systems of `libs/ecs-core`                                |
| Web            | The token's roles for route guards and menu entries; the stored account for the linked barber | `rolesGuard`, `SessionIdentityService`, and gates in the staff dashboard, the client card and the analytics store     |

Facts that shape the design, each read in the code:

1. **The rules read the token only.** No Firestore rule reads
   `users/{uid}`.
2. **The claims are fixed for the session.** They are minted with
   `createCustomToken` at sign-in (`verify-otp.pipeline.ts`,
   `complete-registration.pipeline.ts`); nothing calls
   `setCustomUserClaims`. A role change reaches a session only after a new
   sign-in. `setRoles` revokes the target's refresh tokens, the open web app
   notices within five minutes (`SessionExpiryService`), and the rules keep
   honouring the old token until it expires, up to an hour.
3. **Some callables judge the stored account, some only the token.**
   Stored: `setRoles`, the three roster calls, the team calls (five on
   `main`, `listTeam` in PR #73), the two analytics calls, the three privacy
   calls and `runBackfill`. Token only:
   the staff path of `commitBooking`, `transitionAppointment`,
   `markArrived`, `clearArrival`, `recordSeatTip`, `staffEditAppointment`,
   the impersonation calls and `publishStreakDefinition`.
4. **Staff read most of the book straight from the browser.** Under
   `worksTheBook()`: `appointments`, `appointmentNotes`,
   `appointmentPhotos`, `customers`, `clientStats`, the loyalty documents,
   `clientJournal`, `couponGrants`, `giftVouchers` and single `users`
   documents. Listing `users` (the client search) is an inline list:
   `receptionist`, `admin`, `sysadmin`. A client's lifetime spend
   (`clientStats/*/restricted/*`) is an inline `admin`.
5. **"Own only" exists in three places.** Hours and day exceptions
   (`RosterAccessSystem`), the profile edit (`TeamSystem.admitProfileEdit`)
   and analytics (`StaffAnalyticsSystem`). Each compares the call's barber
   with the stored account's link.
6. **No callable writes a settings document.** `settings/*` is readable by
   anyone and written only with the Admin SDK.

### Gaps found while mapping

These exist today and are not caused by this design. The design closes the
first two; the others are listed so they are not lost.

- **G1. A seat's price change is not money-gated on the server.** The
  `MONEY` list says it covers repricing, but only a new manual discount
  checks it (`billing.system.ts`, `Roles.seesMoney`). `EditCommand.Reprice`
  passes with the book gate alone (`edit-appointment.pipeline.ts`,
  `appointment-edit.system.ts`). The web offers no price field, so it takes
  a crafted call.
- **G2. The token-only callables honour a removed role for up to an hour**
  (fact 3).
- **G3. Keeping the client's own words from `sysadmin` is web-only.**
  `Roles.readsClientWords` is asked in `client-card.store.ts` and nowhere
  on the server or in the rules.
- **G4. The staff client search has no web gate.** It lists `users`
  (`userSearchPorts.searchUsers`), which the rules refuse for a barber. This
  was read in the code; the barber's screen was not run.

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
time, shop, amount or any field) is not needed for a shop of one to fifteen
people, and nobody could audit it by reading a screen. If a second attribute
is ever needed, it becomes a new scope value or a new capability, not a
language.

## Goals vs. Non-Goals

- **Goals:**
  - The owner changes what each level may do from inside the app. A change
    applies to the next call, and nobody is signed out.
  - "Own or everyone" is a first-class scope.
  - The defaults reproduce today's behaviour exactly, and a spec pins that.
  - The owner cannot lock themself out. Owner-only acts cannot be given
    away.
  - One function decides, for the server and the web. The rules read the
    same document.
  - Every permission change is audited with who made it.
  - An owner can be a barber on the same account.
- **Out-of-Scope Non-Goals:**
  - Exceptions for one person. A person's rights come from their levels
    (O3).
  - Levels the owner names and creates (O6).
  - Conditions on time, shop or amount, such as a discount limit that needs
    approval. A grant applies at every shop.
  - Changing how token claims are minted.
  - Permissions for the vendor's `sysadmin`. It keeps today's fixed lists
    and is not shown.
  - Client-facing permissions. A client's own bookings are unchanged.

## Alternatives Weighed

- **More fixed roles.** Rejected: every new wish is a release, and the lists
  already exist in three copies.
- **Per-person switches with no levels.** Rejected: no product surveyed
  starts there, and fifteen people times sixteen switches is unreadable.
- **Owner-named custom levels.** Deferred: `Role` is a closed dictionary
  shared by the claims, the rules, the audit rows and the words. The stored
  shape (P5) does not rule it out.
- **A policy engine.** Rejected, as above.
- **Grants as token claims.** Rejected: the claims are fixed for the session
  (fact 2), so every change would sign the whole team out, and each person
  signs back in with an emailed code.
- **Moving the role claims to `setCustomUserClaims`.** Not needed: the
  server judges the stored account and the rules read the document. It may
  still be worth doing on its own.
- **A list of capabilities per level, or an array of grant structs.**
  Rejected: the rules cannot search an array of maps, and a per-level list
  cannot tell "the owner removed this" from "this capability did not exist
  when the list was saved".
- **Caching the document in each Functions instance.** Rejected: one read
  inside a transaction that already runs is cheap, and a cache would delay a
  narrowing.
- **Hiding things in the web only.** Rejected as a boundary. The web hides
  what the server would refuse, and the server stays the authority.

## Key Decisions & Staging for Next Steps

### P1. Levels are the roles, and the owner edits what a level grants

| Level (stored role) | Word          | Editable                                           |
| ------------------- | ------------- | -------------------------------------------------- |
| `barber`            | Бръснар       | yes                                                |
| `receptionist`      | Рецепция      | yes                                                |
| `content_manager`   | Съдържание    | yes                                                |
| `manager` (new)     | Управител     | yes                                                |
| `admin`             | Администратор | no: everything, always (P4)                        |
| `sysadmin`          | not shown     | no: the vendor's support role, today's fixed lists |

- An account holds a set of levels. For each capability it gets the widest
  scope any of its levels grants.
- **A manager level is added** (O2). Without it the only way to hand over
  running the team is `admin`, which can also change roles and erase client
  data. `Role.Manager` joins the staff lists in code (`Roles.STAFF`,
  `Roles.ASSIGNABLE`, and `Roles.BOOK` while that list exists), the rules'
  `isStaff()` and `worksTheBook()` lists (`role.rules-parity.spec.ts` holds
  them equal), and the words.
- **Taking clients is not a permission.** It is the barber record, which is
  bookable with no account at all (team onboarding D1). The link between an
  account and a record is what gives "own" a meaning.
- Who holds which level is still set in «Роли» (`setRoles`), by the owner.

### P2. The capability catalogue

Defaults are listed for Бръснар / Рецепция / Съдържание / Управител. «—»
is `NONE`. The owner always has `ALL`. Every default but the manager's is
today's behaviour.

| Capability        | What it covers                                                                                         | Scope     | Defaults (Б / Р / С / У)  | Enforced by                                                                                                                   | Stage |
| ----------------- | ------------------------------------------------------------------------------------------------------ | --------- | ------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ----- |
| `BOOKINGS_VIEW`   | See visits on the schedule, with their notes and photos                                                | scoped    | `ALL` / `ALL` / — / `ALL` | Rules: `appointments`, `appointmentNotes`, `appointmentPhotos` and its Storage objects                                        | D     |
| `BOOKINGS_MANAGE` | Book, move, edit, cancel; mark arrived, completed or no-show; record a tip; honour a coupon or voucher | scoped    | `ALL` / `ALL` / — / `ALL` | `commitBooking` (staff path), `transitionAppointment`, `markArrived`, `clearArrival`, `recordSeatTip`, `staffEditAppointment` | B     |
| `TIME_OFF`        | Block time, clear or move a block, change one day's breaks                                             | scoped    | `OWN` / `ALL` / — / `ALL` | `setDayExceptions`                                                                                                            | A     |
| `HOURS`           | Weekly hours and standing breaks                                                                       | scoped    | `OWN` / `ALL` / — / `ALL` | `setRosterWeek`, `amendRosterBreaks`                                                                                          | A     |
| `VISIT_DISCOUNT`  | Give a manual discount on a visit                                                                      | scoped    | — / `ALL` / — / `ALL`     | `staffEditAppointment` (discounts)                                                                                            | B     |
| `VISIT_REPRICE`   | Change a seat's price                                                                                  | scoped    | — / `ALL` / — / `ALL`     | `staffEditAppointment` (reprice); closes G1                                                                                   | B     |
| `CLIENTS_SEARCH`  | Search the whole clientele                                                                             | shop-wide | — / yes / — / yes         | Rules: listing `users`                                                                                                        | C     |
| `CLIENT_CARD`     | Open a client's card: record, history, statistics, loyalty, journal, coupons, vouchers                 | shop-wide | yes / yes / — / yes       | Rules: `customers`, `clientStats`, loyalty, `clientJournal`, `couponGrants`, `giftVouchers`, single `users` documents         | C     |
| `CLIENT_CONTACT`  | See a client's phone and email                                                                         | shop-wide | yes / yes / — / yes       | Needs the contact fields moved first (P7)                                                                                     | D     |
| `CLIENT_SPEND`    | See a client's lifetime spend                                                                          | shop-wide | — / — / — / —             | Rules: `clientStats/*/restricted/*`                                                                                           | C     |
| `ANALYTICS`       | `OWN`: own numbers and goal. `ALL`: the shop, every barber, the shop's goal                            | scoped    | `OWN` / — / — / `ALL`     | `staffAnalytics`, `setAnalyticsGoal`                                                                                          | A     |
| `TEAM_PROFILES`   | A barber's name, photo, title, bio, Instagram, experience                                              | scoped    | `OWN` / — / `ALL` / `ALL` | `editBarber` (profile part)                                                                                                   | A     |
| `TEAM_OFFERINGS`  | A barber's services, prices and durations                                                              | scoped    | — / — / — / `ALL`         | `setBarberOfferings`                                                                                                          | A     |
| `TEAM_MANAGE`     | Add a barber; shops, working period, booking access, «Който и да е», delete a draft; the Team list     | shop-wide | — / — / — / yes           | `addBarber`, `editBarber` (other parts), `deleteDraftBarber`, `listTeam`                                                      | A     |
| `CONTENT`         | Positions, courses and events                                                                          | shop-wide | — / — / yes / yes         | Rules: writes to `positions`, `courses`, `events`; the `admin/programs` route                                                 | C     |
| `LOYALTY`         | The loyalty programme: the rhythm, publishing a streak definition                                      | shop-wide | — / — / — / —             | `publishStreakDefinition`; the `admin/loyalty` routes                                                                         | B     |

The owner's three examples map to grants: booking for a colleague is
`BOOKINGS_MANAGE` at `ALL`, seeing a colleague's schedule is
`BOOKINGS_VIEW` at `ALL`, and blocking time for them is `TIME_OFF` at
`ALL`.

**Not configurable.** Owner only, as today: roles and links (`setRoles`),
the permissions themselves, export and erasure of a client's data,
impersonation, the audit log and trigger failures. Vendor only:
`runBackfill`.

**Left at the fixed staff tier.** `activateBarber` (any staff member's save
may complete a setup), reading draft barber records, the waitlist, lead-time
samples and invitation lists. None of these is something an owner asks to
restrict.

### P3. Own and everyone

- **Own** is the barber record the caller's stored account is linked to. An
  account with an `OWN` grant and no link has nothing of its own and is
  refused.
- `OWN` admits an act when the caller's record is the barber of everything
  the act changes:
  - **Hours and time off:** every barber the call names. This is today's
    `RosterAccessSystem.admit` and `admitDays`, so a barber still cannot
    move a block onto a colleague.
  - **Profiles and offerings:** the barber record the call names.
  - **Analytics:** the scope asked for is the caller's own record.
  - **Bookings:** an act on one seat (tip, duration, price) changes that
    seat's barber. Moving a seat to another barber changes both barbers. An
    act on the visit as a whole (book, arrive, status, move, cancel,
    discount, change of shop) changes every barber on it.
- So on a visit shared with a colleague, an `OWN` caller may change their
  own seat and nothing else; the rest needs `ALL` (O4).
- `ALL` on any level the account holds wins.

### P4. The owner is never locked out

- `admin` has `ALL` on every capability. The editor shows that level as
  locked. The reading guard adds `admin` back whatever the document says,
  and the rules test `admin` before they read the document. A document
  edited by hand in the console cannot lock the owner out.
- Editing permissions is owner-only and cannot be granted (`Roles.ASSIGN`,
  the list that already guards `setRoles`). The last-admin invariant of
  `RoleAssignmentSystem` is unchanged.
- `sysadmin` keeps its place wherever today's lists have it. The owner
  cannot add or remove it.

### P5. Where the grants live

One document, `settings/staffPermissions`. Every field is a list of roles at
the root:

```
/settings/staffPermissions
  bookingsManageAllRoles: ['receptionist', 'manager', 'admin', 'sysadmin']
  bookingsManageOwnRoles: ['barber']        // the owner narrowed barbers to their own visits
  writeOperationId:       'op-7f3a…'        // the save that last wrote it
```

- **Field names.** A scoped capability has `<capability>AllRoles` and
  `<capability>OwnRoles`; a shop-wide one has `<capability>Roles`. That is
  twenty-five role-list fields, every name fixed at design time, so the
  document holds no dynamic keys (Law 5).
- **A pattern and its departures.** The code holds
  `StaffPermissions.DEFAULT`. The document stores only the fields the owner
  changed, and a save deletes a field that is back at its default. No
  document means today's behaviour. A capability shipped later needs no
  migration, and a shop that never touched a capability follows a corrected
  default.
- **The reading guard** `StaffPermissions.read(raw)` never fails. Per field
  it keeps a list of known roles or falls back to the default, adds back the
  locked members (P4), and drops from `Own` a role that is also in `All`.
  It follows `BookingPolicy.withDefaults`.
- **Why a role list per capability.** The rules can test it with one
  `hasAny`, and an absent field is unambiguous.
- **Files.** `StaffCapability` and `GrantScope` are tag dictionaries in the
  primitives tier, because the errors name them. `StaffPermissions` is a
  component (`staff-permissions.data.ts`) with the defaults, the guard and
  the capability-to-field table. The entity is `StaffPermissionsSettings =
{ id } & StaffPermissions & WriteProvenance`, with the fixed id
  `'staffPermissions'`, beside `BookingPolicySettings`.
- **Who reads and writes it.** Only the `setStaffPermissions` callable
  writes; `settings/*` stays closed to client writes. Reading narrows to
  staff for this one document; the other settings stay public.

### P6. Enforcement on the server

- **One pure system.** `StaffAccessSystem.scopeOf(permissions, capability,
roles)` answers the scope. `StaffAccessSystem.admit(capability, caller,
changedBarberIds, permissions, nowUtcMs)` answers a `Result`. It refuses
  an account that is missing, blocked or erased at `nowUtcMs`, or holds no
  staff role, and then applies P3.
- **Read inside the transaction.** Each pipeline reads `users/{caller}` and
  `settings/staffPermissions` in the read step of its one commit, then asks
  the system. This is one extra document where the account is already read
  and two where the call trusts the token today.
- **The wire gate becomes "is staff".** The token cannot know the grants,
  so the first gate of every configurable callable is `Roles.isStaff` on
  the claims. It only keeps clients and anonymous callers out before a
  transaction starts.
- **Effect.** A grant change applies to the next call. So does a role
  change, which closes G2 for acts.
- **Errors.** One file, `errors/access.error.ts`: `ACCESS_DENIED {
capability }` and `ACCESS_OWN_ONLY { capability }`, both answered as
  permission-denied and worded per capability. The domain refusals
  (`SCHEDULING_ROSTER_FORBIDDEN`, `TEAM_FORBIDDEN`,
  `BOOKING_STAFF_EDIT_FORBIDDEN`, `ANALYTICS_FORBIDDEN` and the booking
  ones) retire as each callable converts.
- **The fixed lists.** `Roles.BOOK`, `MONEY`, `ROSTERS`, `TEAM`,
  `TEAM_PROFILES`, `ANALYTICS_SELF`, `ANALYTICS_SHOP` and `SPEND` become
  the default table of the catalogue and are deleted as lists. `STAFF`,
  `ADMIN`, `PRIVACY`, `ASSIGN` and `ASSIGNABLE` stay.
- **The editor's callable.** `setStaffPermissions` takes an operation id
  and a list of changes (`capability`, `role`, `grantScope`). Its system
  refuses a role that is not editable and a scope the capability does not
  have, plans the fields to set and to delete, and writes one audit row
  (P11). A save that changes nothing writes nothing.

### P7. Enforcement for what the browser reads

The rules read the same document, so reads follow the owner's choices
without a new sign-in:

```
function permissions() {
  return exists(/databases/$(database)/documents/settings/staffPermissions)
    ? get(/databases/$(database)/documents/settings/staffPermissions).data
    : {};
}
// `standard` is the default list; a parity spec holds it equal to the code's.
function granted(field, standard) {
  return hasAnyRole(['admin'])
    || (isStaff() && hasAnyRole(permissions().get(field, standard)));
}
```

- **Cost.** A rule that reads a document is billed one read per request,
  however often the rule names it, and also when the request is refused. So
  each governed request by a staff member costs one more read. The owner and
  a client reading their own data are answered before the document is read.
  The limit of ten such calls per request is far away. Storage rules may
  read two Firestore documents per evaluation; `appointmentPhotos` reads
  none today.
- **When a change takes effect.** The next request sees it. Whether an
  already open listener is cut is not documented for Firestore, so the
  emulator suite must prove it, and the web re-attaches its streams when the
  document changes (R1).
- **Two capabilities need more than a rule.** They are stage D and start
  with a spike:
  - `BOOKINGS_VIEW` at `OWN`. The rule must know the caller's barber (one
    more document) and the query must prove it returns only that barber's
    visits. The staff day reads `busyKeys array-contains
'<barber>__<date>'`, which a rule cannot tie to a barber, so the query
    and its index change.
  - `CLIENT_CONTACT`. The phone and email are fields of the appointment
    (`contactPhone`, `contactEmail`) and of the client record. A rule cannot
    hide a field, so they move to a restricted sibling document, as the
    lifetime spend already is, and every reader changes.

### P8. The web

- **One service.** `StaffAccessService` (beside `SessionIdentityService`)
  holds the signed-in account and a stream of the document, and answers
  `scopeOf(capability)` and `mayFor(capability, barberId)` as signals, by
  calling `StaffAccessSystem`. It reads the stored account's roles, as the
  server does, and the token only until the account has loaded.
- **What the screens do with it.** `NONE`: the entry point is not shown.
  `OWN`: it is shown on the caller's own lane or record, and a colleague's
  is read-only. This is where the Team screen's open items land (hiding the
  hours and block entry points on a colleague's lane).
- **Routes.** A `capabilityGuard` replaces `rolesGuard` on routes behind a
  configurable capability (analytics, programmes, loyalty, the Team
  screen).
- **The existing gates move to it:** the manual discount arms
  (`mayReprice`), the analytics scope picker, the client card's spend block
  and the client search, which closes G4.
- **One new port bundle** for the stream, typed against one
  `InjectionToken` (Law 9).

### P9. The owner as a barber

- The model already allows it: roles `barber` and `admin` on one account,
  linked to a barber record. The block is `GOVERNANCE_ROLES_SELF`.
- **Decision:** `setRoles` admits a change to the caller's own account when
  the requested set still holds `admin`. Everything else in
  `RoleAssignmentSystem.decide` is unchanged: the link rules, the lock on
  the barber record, the assignable set.
- **The last-admin invariant still holds by construction.** After every
  admitted plan the caller is an admin. The property spec gains the self
  case.
- **Nobody is signed out.** A self-change skips the session revoke. The
  caller's token keeps `admin`, which passes every gate that asks the
  token, and a stale lesser claim adds nothing to it. The barber role and
  the link are on the stored account, which the callables and the web
  read.
- **Where.** On the Team screen, a barber record with no linked account
  offers «Това съм аз» to an admin. The record's page then offers «Не съм
  аз».
- This overturns the cut in team onboarding ("An admin linking their own
  account as a barber"). The reason for the cut was token handling, which
  the line above removes.

### P10. The screens

- **«Екип» → «Права».** A list of the levels. Each row names who holds the
  level and how far it departs from the standard («3 промени»).
- **A level's page.** Rows grouped as the catalogue is. A scoped capability
  is a value row with a menu: «Не · Само своите · Всички». A shop-wide one
  is a switch. A changed row is marked. The dock holds «Запази»; a receipt
  follows with «Отмени». «Върни стандартните» resets the level.
- **«Администратор».** One read-only line: everything, always.
- **A team member's page.** «Какво може»: the person's effective rights,
  each with the level that grants it, and a link to «Роли».
- A design pass with a prototype comes before the build, with design-system
  elements only.

| Group      | Capability        | Row label                   |
| ---------- | ----------------- | --------------------------- |
| График     | `BOOKINGS_VIEW`   | Вижда графика               |
| График     | `BOOKINGS_MANAGE` | Записва и променя часове    |
| График     | `TIME_OFF`        | Блокира време               |
| График     | `HOURS`           | Променя работното време     |
| Каса       | `VISIT_DISCOUNT`  | Дава отстъпка               |
| Каса       | `VISIT_REPRICE`   | Променя цена на посещение   |
| Клиенти    | `CLIENTS_SEARCH`  | Търси във всички клиенти    |
| Клиенти    | `CLIENT_CARD`     | Отваря картона на клиент    |
| Клиенти    | `CLIENT_CONTACT`  | Вижда телефон и имейл       |
| Клиенти    | `CLIENT_SPEND`    | Вижда похарченото от клиент |
| Анализи    | `ANALYTICS`       | Вижда анализи               |
| Екип       | `TEAM_PROFILES`   | Редактира профил на бръснар |
| Екип       | `TEAM_OFFERINGS`  | Определя услуги и цени      |
| Екип       | `TEAM_MANAGE`     | Управлява екипа             |
| Съдържание | `CONTENT`         | Редактира съдържанието      |
| Съдържание | `LOYALTY`         | Управлява лоялната програма |

### P11. Audit and measures

- **One row per save, credited to the caller:** `TEAM_PERMISSIONS_CHANGED`,
  with one element per level and capability whose scope changed
  (`capability`, `role`, `grantScopeFrom`, `grantScopeTo`). It lands in the
  save's own commit.
- The document is stamped with the operation, and
  `GovernedChangeSystem.auditedByCallable` skips the settings trigger's
  generic row for a stamped write, as it does for `barbers` and
  `services`.
- **Refusals** are logged with the capability and the scope found, and no
  personal data. A rise in refusals for one capability after a change means
  the owner cut something people need.

### P12. What is added, by tier

- **Primitives:** `StaffCapability`, `GrantScope`; the fixed settings id.
- **Errors:** `access.error.ts`.
- **Components:** `staff-permissions.data.ts`; `Role.Manager`; a call
  component for the editor's request; the audit context for the change.
- **Entities:** `StaffPermissionsSettings`.
- **Systems:** `StaffAccessSystem`; a planner for the editor's save; the
  audit plan.
- **Ports:** a stream bundle for the web. The server reads through the
  transaction it already has.
- **Pipelines:** `set-staff-permissions.pipeline.ts`; one shared reader of
  the caller and the document.
- **Functions:** the wire decoder and the `setStaffPermissions` export.
- **Rules:** the two helpers of P7 and the narrower read on this document.
- **Indexes:** none. No query reads these fields.
- **Seed:** the manager's words; no document, since the defaults are code.

### Cost

- **Acts.** Two more document reads per staff call, one where the account
  is already read. Three hundred staff acts a day is six hundred reads,
  about a cent a month at list price.
- **Reads (stage C).** One more read per governed request by a staff
  member. A schedule that opens eight listeners costs eight reads more per
  opening.
- **Latency.** One more document in a transaction's read step.

### Risks

- **R1. An open listener may outlive a narrowing.** Not documented for
  Firestore. Stage C proves it in the emulator; the web re-attaches on a
  change; the token refresh bounds the rest.
- **R2. The owner narrows too far and staff are stopped mid-day.** A change
  works both ways at once, the level's page shows who it affects, one tap
  resets a level, and refusals are counted.
- **R3. The defaults exist twice,** in code and as the rules' fallback
  lists. A parity spec holds them equal, as `role.rules-parity.spec.ts`
  does for the role lists.
- **R4. Shared visits under `OWN`** need the front desk (P3, O4).
- **R5. The booking calls gain two reads on the busiest write path.**
  Stage B watches their latency.
- **R6. Sixteen rows on four levels is a lot to read.** The defaults are
  usable untouched, the rows are grouped, and each level shows a one-line
  summary.

### Open decisions (author's call, owner may overturn)

- **O1. The defaults keep today's behaviour,** so a barber may act on any
  visit until the owner narrows it. The alternative is to ship barbers at
  `OWN` for `BOOKINGS_MANAGE`, as Booksy and Square do for their lowest
  level. The author keeps today's behaviour because nothing should change
  on the day this ships.
- **O2. A manager level is added.** The alternative is to tick more boxes
  on «Рецепция», which makes every receptionist a manager.
- **O3. No exceptions for one person.** A senior barber who also books for
  others holds two levels. If two levels prove too coarse, a per-person
  list of departures on the account fits the same model.
- **O4. A shared visit needs `ALL` for anything beyond the caller's own
  seat.** The alternative lets an `OWN` caller mark the whole party
  arrived.
- **O5. Own-only schedule visibility and hidden contact details come
  last,** behind a spike, because they change queries and stored shapes.
  If hiding client contacts from barbers matters most, stage D's second
  half can move ahead of C.
- **O6. No owner-named levels.**
- **O7. A manager cannot change roles.** Roles stay with the owner.

### Staging

Each stage is useful on its own and changes no behaviour until the owner
edits something, except where it closes a gap.

**0. The owner as a barber.** `setRoles` admits a self-change that keeps
`admin`, with no revoke. Exit: the pipeline and property specs, and an
emulator case that links an admin to a record and reads their own
analytics.

**A. The engine, and the calls that already read the account.** The
catalogue, the defaults and the spec that pins them to today's lists;
`StaffAccessSystem`; the settings entity; `setStaffPermissions` with its
audit row; the roster, team and analytics callables converted. Exit: each
converted pipeline's spec refuses and admits by the document, and an
emulator case narrows a level and sees the next call refused.

**Team screen (team onboarding slice 5), with the permission screens.**
`StaffAccessService`, the gates of P8, «Права» and «Какво може». It is
built after A so it is written once.

**B. The booking calls.** `BOOKINGS_MANAGE`, `VISIT_DISCOUNT`,
`VISIT_REPRICE` and `LOYALTY`. Closes G1 and G2. Exit: the e2e booking
suite stays green with a seeded staff account, and a barber's crafted
reprice is refused.

**M. The manager level.** The role, the lists, the rules and the words. It
can ship any time after A.

**C. What the rules guard.** `CLIENTS_SEARCH`, `CLIENT_CARD`,
`CLIENT_SPEND` and `CONTENT`, with the rules helpers, the parity spec and
the listener proof of R1.

**D. Own-only schedule and hidden contacts.** A spike for each, then a go
or no-go from the owner.

## Sources

Vendor help pages, read 2026-11-13:

- Fresha: <https://www.fresha.com/help-center/knowledge-base/team/100687-create-permission-roles>,
  <https://www.fresha.com/help-center/knowledge-base/team/100692-manage-permission-roles>,
  <https://www.fresha.com/help-center/knowledge-base/workspace-settings/100665-transfer-workspace-ownership-access-1>
- Booksy: <https://support.booksy.com/hc/en-us/articles/16535688940946-How-do-I-manage-staff-permissions>
- Square: <https://squareup.com/help/us/en/article/5822-employee-permissions>,
  <https://squareup.com/help/us/en/article/6372>
- Vagaro: <https://support.vagaro.com/hc/en-us/articles/18977275541531-Configure-Access-Levels-and-Employee-Permissions>
- Firestore rules, billing and limits: <https://firebase.google.com/docs/firestore/pricing>,
  <https://firebase.google.com/docs/firestore/security/rules-conditions>,
  <https://firebase.google.com/docs/storage/security/rules-conditions>
