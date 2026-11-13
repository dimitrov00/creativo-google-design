# Team onboarding: adding, inviting and setting up staff

- **Author:** Dimitar Dimitrov (owner), drafted with Claude
- **Date:** 2026-11-13
- **Stage:** RFC for team feedback, before the formal design. Revised after
  two Goldfish review rounds (six lenses each, all completed). The owner
  delegated every decision to this brief; each decision is the author's
  call and the owner may overturn any of them (the open ones are listed
  under "Open decisions"). Raw findings:
  `docs/designs/team-onboarding-review/goldfish_brainstorm_round1.md` and
  `docs/designs/team-onboarding-review/goldfish_brainstorm_round2.md`.
- **Next:** once feedback is in, `/egm-draft docs/designs/team-onboarding.md`
  starts the formal design.

## Overview

The shop needs a way to bring a new person onto the team from inside the
app, and to let them go again, without Firebase console writes.

**What exists today.** A barber is a public profile (`barbers/{id}`), a
weekly roster (`barberSchedules/{id}`) and one price-and-duration entry per
service (inside `services/{id}.offerings[]`). Profile and prices can only be
written from the console; the roster has callable writers. A login account
becomes staff when an admin changes its roles on the client card («Роли»,
the `setRoles` callable), and only after the person has signed in and
registered once. Rules and callables read a person's roles from their
sign-in token, which is minted at sign-in.

**What this feature adds.**

1. A **Team page** («Екип») for the admin, listing every team member with
   their stage.
2. **Adding a member** from a preset. A barber record is created at once and
   can be booked without the person ever having an account.
3. **Editors** for a barber's profile, photo, shops, services and prices,
   hours and working period. They serve every later change too.
4. **Server-side bookability.** A member who is not ready, is staff-only,
   has not started or has left cannot be booked, priced or counted, even by
   a crafted request.
5. **Leaving and coming back.** A leaver's staff access ends the day after
   their last day, including the session on their phone. A rehire keeps one
   record and one history.
6. An optional **email invite**. The person signs in with the existing
   email code, accepts, and is in the staff area in that same sign-in.
7. A small **setup card** for the newcomer, asking for whatever profile
   details are still empty.

Email is the only delivery channel; SMS, Viber and WhatsApp are out because
of cost. Production does not exist yet.

### Words used in this brief

| Word             | Meaning                                                                                                            |
| ---------------- | ------------------------------------------------------------------------------------------------------------------ |
| Barber record    | `barbers/{id}`: the profile of a person who cuts hair. Exists with or without an account.                          |
| Account, profile | `users/{uid}`: a login with its `roles`. On screen it is «профил», never «акаунт».                                 |
| Link             | `users/{uid}.linkedBarberId` plus its lock `barbers/{id}/restricted/link`: which barber record an account is.      |
| Roster           | `barberSchedules/{id}`: weekly hours, in versions that start and end on shop days.                                 |
| Day exception    | `scheduleExceptions`: a closed day or changed hours on one shop day.                                               |
| Offering         | One barber's price and duration for one service, stored on the service.                                            |
| Working period   | The start day and optional last day on the barber record (D2).                                                     |
| Lifecycle        | `barberStatus` and its variant fields (D2).                                                                        |
| Go live          | Leave `DRAFT` for `STAFF_ONLY` or `PUBLIC`.                                                                        |
| Preset           | A set of default values on the add sheet (D4).                                                                     |
| Team page        | The admin's «Екип» screen. Not the public team section of the landing page.                                        |
| Member page      | One member's page, opened from the Team page.                                                                      |
| Add sheet        | The «Добави» sheet on the Team page.                                                                               |
| Staff home       | `/staff/schedule`, where staff land.                                                                               |
| Front desk       | The `receptionist` role.                                                                                           |
| Content editor   | The `content_manager` role.                                                                                        |
| Asker tier       | Who is booking: a client online (`CLIENT`) or staff (`STAFF`).                                                     |
| «Който и да е»   | The client's "any barber" choice (`BarberPreference.Any`).                                                         |
| Lane             | One barber's column on the staff schedule.                                                                         |
| Proven email     | The email on the Firebase Auth record, set only from the address the email code reached, and marked verified (D7). |
| Capacity         | The `capacity/{YYYY-MM}` projection that `/book` reads for free time.                                              |

## Analysis

### Review status

| Round              | Reviewers        | Blockers | Major | Nits |
| ------------------ | ---------------- | -------- | ----- | ---- |
| 1 (first draft)    | 6 of 6 completed | 5        | 28    | 11   |
| 2 (first revision) | 6 of 6 completed | 1        | 30    | 10   |

The author checked every blocker in both rounds against the code. All six
hold.

### What round 1 changed

- The working period moved off the roster, because every hours save
  rewrites the roster's versions.
- One pure server system now decides bookability; before, nothing new was
  enforced on the server.
- Accepting an invite got its own system, keeps the person's existing roles
  and mints a fresh token instead of signing them out.
- The invite is matched on the proven email, not on `users.email`, which
  the registration form could set to anyone's address.
- Three booking switches became one lifecycle field and one flag.
- Course students became a preset. Leaving moved to the first stages.

### What round 2 changed

1. **A leaver's session now ends.** The draft only edited the stored roles,
   but access lives in the sign-in token
   (`firestore.rules:32-36`, `caller-roles.ts`). The daily close now has its
   own decision, revokes the leaver's refresh tokens after its commit, keeps
   a marker until the revoke succeeds, and is credited to the system (D10).
2. **The invite id is a keyed digest.** A plain sha256 of an email can be
   reversed by guessing addresses; the repository's rule for ids built from
   contact details is a keyed HMAC (OR-26). D7 uses a dedicated key.
3. **The purge works.** Firestore TTL deletes only on the adapter-stamped
   `purgeAt` Timestamp; the draft put it on a number field. D7 adds a
   proper retention group.
4. **The setup ledger is gone.** Everything bookings depend on stays with
   the shop by default, so the newcomer's setup is derived from the barber
   record alone. This also removed per-item owners, the go-live setting, a
   stale invite pointer and a second rules `get()` (D5, D9).
5. **Going live is one idempotent step,** called after an editor saves,
   instead of a readiness check inside every editor's transaction (D9).
6. **Smaller scope.** Cut: the `verifyOtp` invite hint, the self path for
   an owner who cuts hair (they become a no-email «Бръснар»), notification
   machinery (reminders are derived cards), the handle rule, the image
   library.
7. **New, needed pieces.** Day-exception writes move behind a callable so
   "own hours only" can be enforced (D5). «Изтрий» for a member who never
   went live (D10). A Team list callable, because accounts cannot be queried
   by role today (D8).
8. **Corrected claims.** Staff bookings do not ignore overlap today;
   `admitTarget` does not check blocks and is not exported; `shop` is
   reserved on barber ids (which are random UUIDs), not on handles.

### Where each round-2 finding went

| Finding                          | Resolution                                                             |
| -------------------------------- | ---------------------------------------------------------------------- |
| B1 leaver keeps a session        | D10 close decision, revoke after commit, retry marker                  |
| M1 close job rules               | D10 actor, admin holders, zone, catch-up, roster close, failures       |
| M2 unkeyed invite id             | D7 `StaffInviteKeyPorts` under `STAFF_INVITE_ID_KEY`                   |
| M3 TTL field                     | D7 retention group on `purgeAt`                                        |
| M4 re-invites, stale pointer     | D7 create rule; pointer removed with the ledger                        |
| M5 client-changed Auth email     | D7 `emailVerified` at provisioning, checked at accept, preflight       |
| M6 unsent invite                 | D7 `NOT_SENT                                                           | SENT | FAILED` with variant fields |
| M7 read rule and rehire          | D2 rehire skips `DRAFT`; D3 single gets for names                      |
| M8 public DRAFT photo            | D5 unguessable object names, list denied                               |
| M9 day-exception gate            | D5 exceptions behind a callable (O4)                                   |
| M10 roles and go-live            | D5 roles are not a go-live item                                        |
| M11 go-live coupling             | D9 `activateBarberIfReady`, automatic only (O2)                        |
| M12 edits trapped                | D3 verdict only on seats being placed                                  |
| M13 Team read path               | D8 `listTeam` callable, `users.roles` index                            |
| M14 stage tags                   | D8 one lifecycle tag, one note, counts                                 |
| M15 reminders                    | D10 derived cards, no notifications                                    |
| M16 email check answers          | D8 five answers; rehire from the Team page                             |
| M17 non-barber and guest presets | D4, D8 save per preset, landing per role                               |
| M18 empty needed group           | D9 one card, derived; dismissible when nothing needed                  |
| M19 `/join` states               | D9 merged state, unregistered state, shared device                     |
| M20 invitee recognition          | D9 `redirect=/join` input; hint cut                                    |
| M21 two profile rows             | D9 one row                                                             |
| M22 self path and «Свържи»       | Self path cut; D8 confirmation warns about re-login                    |
| M23 `LocalizedText`              | D5 English written as Bulgarian when left blank (O5)                   |
| M24 "every shop"                 | D5 empty list keeps its meaning; roster hook and code                  |
| M25 listing leftover bookings    | D10 busy days, then `appointments` by `busyKeys`                       |
| M26 errors and tiers             | D11 full code list, dictionaries in primitives                         |
| M27 audit                        | D12 one action per callable, `writeOperationId` join                   |
| M28 deleting a mistaken draft    | D10 «Изтрий»                                                           |
| M29 stage 0 inventory            | Staging stage 0, consumer table                                        |
| M30 stage 1 size and tests       | Staging split into 1a and 1b, pipeline-level close test, go/no-go gate |
| N1 `shop` reservation            | D5 handle rule dropped                                                 |
| N2 image library                 | D5 browser dimensions, blurhash `null`                                 |
| N3 overlap wording               | D3 corrected                                                           |
| N4 `@launchBlocker`              | D7                                                                     |
| N5 ledger rules                  | Moot: no ledger                                                        |
| N6 accept details                | D7 read-only retry, session row, `operationId`                         |
| N7 cost rows                     | Cost table                                                             |
| N8 Bulgarian copy                | Neutral forms throughout; D8, D9                                       |
| N9 leave span                    | D10 `LeaveSystem`                                                      |
| N10 consistency                  | This rewrite                                                           |

Round-1 findings that round 2 judged closed stay as they were. Those it
judged partly closed are covered by the rows above.

## Goals vs. Non-Goals

- **In-Scope Goals:**
  - The Team page: every member with a worded stage, and one page per
    member.
  - Adding a member from a preset, with or without an account.
  - Editors for profile, photo, shops, services and prices (with copy from
    another barber), hours, day exceptions and working period.
  - Server-side bookability on every booking, availability, price, capacity
    and waitlist path.
  - Going live automatically once the shop's items are done.
  - Linking an existing account («Свържи профил»).
  - Leaving: listing leftover bookings, ending staff access and sessions the
    day after the last day. Rehiring onto the same record. Deleting a
    member who never went live.
  - Reminder cards before any last day.
  - Email invites: create, send, resend, revoke, expire, accept.
  - The newcomer's setup card.
  - Course students and guest barbers as presets.
  - Two existing holes closed: registration may no longer set an email other
    than the one that signed in, and a barber may no longer edit another
    barber's hours or day exceptions.

- **Out-of-Scope Non-Goals:**
  - SMS, Viber or WhatsApp.
  - Course enrollment, payment, attendance, grading, certificates; a
    supervisor field or course link on a student.
  - Chair rental; a barber setting their own prices; per-location prices for
    one barber.
  - An approval queue for what a newcomer fills in.
  - Invites that grant `admin`. A second admin is made in «Роли» after they
    join.
  - Invites in a phone-code deployment (no email is proven there).
  - An admin linking their own account as a barber. An owner who also cuts
    hair is a «Бръснар» with no account; the admin already edits everything.
  - Holding a ready member back from going live (a manual go-live mode).
  - Inbox notifications for team events.
  - Telling `verifyOtp` callers about a pending invite. Added only if the
    acceptance measure shows invites being missed.
  - Moving a leaver's future bookings to another barber. «Напускане» lists
    them; moving them is a later piece.
  - Email bounce tracking through a provider webhook.
  - A lifecycle for front desk and content editors. Leaving is a role
    removal in «Роли»; the audit trail is their history.
  - Several businesses in one deployment.

## Alternatives Weighed

- **A form builder for onboarding steps.** Rejected: the steps are fixed by
  the data model.
- **Account first.** Rejected: some barbers never use apps.
- **The email link as proof of identity.** Rejected: a forwarded email
  would hand over the account.
- **Accepting automatically on sign-in.** Rejected: the newcomer should see
  the roles and what they can see first.
- **Three independent booking settings.** Rejected (round 1): 5 of 12
  combinations meant something.
- **Start and last day on the roster.** Rejected (round 1): hours saves
  rewrite the versions.
- **No `DRAFT` state, derived from data.** Rejected: the public list and the
  read rule need a stored field.
- **A separate apprentice variant.** Rejected (round 1): its fields repeat
  title, last day and offerings.
- **Invites bound to an existing account, invites that grant `admin`, a
  pre-sign-in invite page, a decline state, cooldowns and caps.** Rejected
  (round 1).
- **Matching on `users.email`, or on the Auth email without the verified
  flag.** Rejected (rounds 1 and 2): the first can be set by the form; the
  second is unverified against a client changing its own Auth email.
- **An invite id from a plain hash of the email.** Rejected (round 2):
  reversible by guessing; the repository requires a keyed digest.
- **A setup ledger with per-item owners.** Rejected (round 2). With hours
  owned by the shop by default, the only things a newcomer is asked for are
  optional profile details, and whether they are empty can be read off the
  barber record.
- **A readiness check inside every editor's transaction.** Rejected
  (round 2): it makes routine hours saves read every service and couples
  each editor to onboarding.
- **A per-member «Автоматично · Ръчно» go-live setting.** Rejected: it is
  the kind of setting the owner asked to avoid. Open as O2.
- **Notification topics, payloads and recipients for reminders.** Rejected:
  a card derived from the last day and today's date needs none of it.
- **The `verifyOtp` pending-invite hint.** Cut: it touches every sign-in for
  a rare event and could pull a client out of a booking.
- **Rehire through `DRAFT`.** Rejected (round 2): it would hide the barber's
  name on clients' past visits under the read rule.
- **The admin self-linking as a barber.** Cut (round 2): it needs its own
  decision and token handling for no booking gain.
- **A `linkedBarberId` token claim, or one rules `get()` per exception
  write.** Rejected in favour of a callable (O4): a claim must be re-minted
  on every link change, and a `get()` per write breaks the zero-read design
  of multi-day blocks.
- **An image library in Cloud Functions.** Rejected: the browser already
  measures the image and blurhash is nullable.
- **A unique handle with transliteration.** Rejected: nothing reads
  `handle` in production.
- **A barber-only text type with optional English.** Rejected for now in
  favour of writing English as Bulgarian when left blank (O5).
- **Building no invite.** Kept as the gate after stage 1 (O7).

## Key Decisions & Staging for Next Steps

### D1. Three records

- **Barber record** (`barbers/{id}`): the craftsman. It can exist, go live
  and be booked with no account. New ids come from `nextId` (random UUIDs).
- **Account** (`users/{uid}`): the login and its roles.
- **Staff invite** (`staffInvites/{id}`): a short-lived offer: "whoever
  signs in with this proven email gets these roles and, for a barber, this
  barber record".

Nothing else is stored for onboarding. What a newcomer still has to fill in
is read off the barber record.

### D2. The barber lifecycle and the working period

**The lifecycle component** (`barber-lifecycle.data.ts`, `BarberLifecycle`)
is a union of flat variants:

| `barberStatus` | Variant-only fields                                                                                                                    |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `DRAFT`        | `barberDraftTargetStatus: STAFF_ONLY \| PUBLIC`                                                                                        |
| `STAFF_ONLY`   | none                                                                                                                                   |
| `PUBLIC`       | none                                                                                                                                   |
| `DEPARTED`     | `barberDepartedUserId: UserId \| null`, `barberSessionsRevokedAtUtcMs: UtcEpochMs \| null`, `barberRehireStatus: STAFF_ONLY \| PUBLIC` |

Every variant also has `barberStatusChangedAtUtcMs`, rewritten on every
transition. The audit rows hold the full history. Today's `ACTIVE` maps to
`PUBLIC` and `INACTIVE` to `DEPARTED`.

A `DRAFT` record has never been live: a rehire returns to its
`barberRehireStatus`, never to `DRAFT`.

**The flag.** `barberJoinsAnyPool: boolean`, a root field on every variant,
read only in `STAFF_ONLY` and `PUBLIC`.

**The working period.** `barberStartsLocalDate: LocalDate` and
`barberLastWorkingLocalDate: LocalDate | null`, root fields, admin-only.
The roster keeps hours only. Bookability ignores roster days outside the
period, so an hours edit cannot move a start or erase a last day.

| What                                                | DRAFT            | STAFF_ONLY                   | PUBLIC  | DEPARTED                   |
| --------------------------------------------------- | ---------------- | ---------------------------- | ------- | -------------------------- |
| Public team section and `/book` picker              | no               | no                           | yes     | no                         |
| Given to a «Който и да е» booking                   | no               | if flag, staff bookings only | if flag | no                         |
| Lane on the staff schedule                          | no               | yes                          | yes     | only on days with bookings |
| Front desk can book, inside the period              | no               | yes                          | yes     | no                         |
| Client can book online, inside period and hours     | no               | no                           | yes     | no                         |
| Name on clients' past visits                        | never has visits | yes                          | yes     | yes                        |
| Counted in public «от» prices and `/book` free time | no               | no                           | yes     | no                         |
| Staff analytics scope menus                         | no               | yes                          | yes     | history only               |
| `barbers/{id}` readable by anyone                   | no, staff only   | yes                          | yes     | yes                        |

Holidays, illness and long leave are **not** states (D10).

### D3. Bookability is decided on the server

- **`BarberBookabilitySystem.verdictOf(barber, service, askerTier,
barberPreference, localDate)`** answers bookable, or one reason tag:
  `BARBER_NOT_READY`, `BARBER_STAFF_ONLY`, `BARBER_DEPARTED`,
  `BARBER_BEFORE_START`, `BARBER_AFTER_LAST_DAY`, `BARBER_NOT_IN_ANY_POOL`,
  `BARBER_DOES_NOT_OFFER`. It takes the `Service` as it is, so it can check
  the offerings itself.
- **`BarberBookabilitySystem.blockersOf(barber, services, roster, shopNow)`**
  answers every reason nobody can book this barber from today on. The
  member page shows it after going live too, for example when the last
  offering was removed. That never changes the status.
- **The verdict applies to a seat being placed** (book, add a seat, move,
  change barber, change shop) and to the barber it is placed on. Cancelling,
  editing an unchanged seat, repricing and moving a seat away from a barber
  who cannot be booked stay open, so a leaver's last-day visits can still be
  corrected the next morning.
- **Every decision path calls it:** book, reschedule and staff edit;
  availability and the «Който и да е» pool; the waitlist matcher; price
  tiles, spans and performer lists; `/book`'s capacity reader; the
  lead-time sampler.
- **The booking read set** adds `barbers/{id}` for each named barber, or
  each pool candidate: at most one read per staff member. A refusal answers
  `BOOKING_BARBER_NOT_BOOKABLE` with the reason tag.
- **Staff bookings** may still ignore hours and notice, and may overlap
  only after acknowledging it, as today. They may not ignore the lifecycle
  or the working period.
- **Three web reads** replace today's one `ACTIVE`-only stream:
  - public: `barberStatus == 'PUBLIC'`;
  - staff: `barberStatus in ['STAFF_ONLY', 'PUBLIC']`, plus `DEPARTED` on
    days with bookings;
  - names by id, as single document gets, for past visits.
    Both queries use the existing `(barberStatus, sortOrder)` index. Stage 0
    assigns every consumer to one of these (see Staging).
- **The read rule.** `barbers/{id}` allows read when
  `resource.data.barberStatus != 'DRAFT' || isStaff()`. The public query
  filters on `== 'PUBLIC'`, so the rules engine can prove it. Clients read
  names by single gets, never by a `documentId() in` query. A `DRAFT`
  barber's offerings on `services/*` remain readable (an id and prices, no
  name or photo); accepted.

### D4. Presets fill defaults

| Preset         | Creates       | Roles if invited              | Goes live as   | «Който и да е» | Email field              | Last day       |
| -------------- | ------------- | ----------------------------- | -------------- | -------------- | ------------------------ | -------------- |
| «Бръснар»      | barber record | `barber`                      | `PUBLIC`       | in             | optional                 | none           |
| «Курсист»      | barber record | `barber`, with the O1 warning | `STAFF_ONLY`   | out            | optional, off by default | required       |
| «Гост бръснар» | barber record | none (no account)             | `PUBLIC`       | in             | hidden                   | required       |
| «Рецепция»     | invite only   | `receptionist`                | not applicable | not applicable | required                 | not applicable |
| «Съдържание»   | invite only   | `content_manager`             | not applicable | not applicable | required                 | not applicable |

Before invites exist (stages 0 to 2), «Рецепция» and «Съдържание» are a
«Роли» change on an account that has already signed in once.

Every default can be changed on the add sheet.

### D5. Setup items, permissions and field rules

**What a barber needs before anyone can book them** (all owned by the shop):
name, start day, shops, at least one offering, and hours with at least one
segment inside the working period. Roles are never a go-live item: an
account is optional. `StaffSetupSystem.checklistOf(barber, services,
roster)` computes this from the records, nothing stored.

**Optional profile items:** photo, title, bio, Instagram, years of
experience. Empty ones are what the newcomer's setup card asks for (D9).

**Permissions.** Fixed; each editor's system judges the caller's stored
roles and link inside its transaction.

| What                                                                                                         | Admin                      | Front desk | The barber (linked account) | Content editor | Sysadmin       |
| ------------------------------------------------------------------------------------------------------------ | -------------------------- | ---------- | --------------------------- | -------------- | -------------- |
| Name, photo, title, bio, Instagram, experience                                                               | yes                        | no         | own only                    | yes            | no             |
| Hours, breaks, day exceptions                                                                                | yes                        | yes        | own only                    | no             | yes (as today) |
| Shops, services and prices, working period, status, «Който и да е» flag, add, delete, leave, rehire, invites | yes                        | no         | no                          | no             | no             |
| Roles and links                                                                                              | yes (`setRoles`, as today) | no         | no                          | no             | no             |

- The admin-only row gets one grant, `Roles.TEAM: [Role.Admin]`.
  `Roles.MONEY` includes the front desk and is about discounts, so it is
  the wrong rule.
- **Hours.** `setRosterWeek` and `amendRosterBreaks` read `barbers/{id}`
  and the caller's account inside their transactions and refuse a barber
  editing someone else's roster, any edit on a `DEPARTED` record, and
  segments at a shop the barber does not work at.
- **Day exceptions move behind a callable** (`setDayExceptions`), which does
  the same checks and writes a multi-day series in one commit. Today they
  are client writes that any staff member may make, and the rules cannot
  tell which barber the caller is (`firestore.rules:58-74`). O4.
- The rules spec that asserts any barber may write exceptions changes with
  it.

**Field rules.**

- **Name** is required at «Добави». The barber may edit it later.
- **Title and bio** become `LocalizedText | null`.
- **Language.** Editors ask for Bulgarian, with English under «Превод (по
  желание)». Blank English is saved as the Bulgarian text, so the type
  (`LocalizedText`, both languages required) does not change. This applies
  to name, title and bio. O5.
- **Handle.** Nothing reads it in production. Stage 0 drops the field if a
  final search confirms no reader; otherwise it is set to the id.
- **Sort order.** A new member goes last; the admin reorders on the Team
  page.
- **Shops.** Picked at «Добави»; a one-shop business never sees the row. An
  empty `locationIds` keeps its meaning, "every shop", shared with services.
  Roster segments must be at a shop the barber works at
  (`SCHEDULING_ROSTER_OUTSIDE_SHOPS`). Removing a shop is refused while
  current or future roster versions have segments there. One person at two
  shops is one record with segments at each.
- **Photo.** The browser downscales the image and reports its size (as
  `downscaleImage` does today), and uploads it to a staff staging path
  `staffUploads/{uid}/{file}`. Its rule: write if signed in with a staff
  role, image types only, a size limit; no client reads. A callable checks
  the size with `MediaRef.parse`, copies the file to
  `media/barbers/{id}/{random}.jpg`, and writes the `avatarMedia*` fields
  with blurhash `null` and a centred focus. In `storage.rules`,
  `media/barbers` allows get but not list. The object name is unguessable
  and a `DRAFT` record (which holds the path) is staff-only, so a draft's
  face cannot be found. A newcomer who already has a client avatar can pick
  it as the source instead.

### D6. Course students and guest barbers

- **«Курсист»** is a «Бръснар» record with the D4 defaults and the title
  «Курсист».
- **Copying prices** (stage 4 for scaling; plain copy is in stage 1a, since
  typing 30 prices for any new barber is the real chore). One transaction
  writes the new barber's offering on every service the source barber
  offers, validated with `BarberOffering.parseAll`:
  - prices scaled by a percentage, rounded to the nearest 50 minor units,
    ties upward;
  - variant overrides scaled the same way;
  - durations optionally lengthened by a percentage, rounded up to 5
    minutes;
  - a one-time snapshot; later changes to the source do not follow.
- **«Завърши обучението»** opens the editors prefilled: title «Бръснар», last
  day cleared, status `PUBLIC`, pool in, and a fresh price copy. Same record.
- **Dropping out** is «Напускане» (D10).
- **Privacy.** The `barber` role reads every booking and opens every client
  profile. A student therefore gets no account by default. If the admin
  invites one, the add sheet and the accept screen say «Ще вижда всички
  записи и профилите на клиентите.» O1.

### D7. The staff invite

**What it can grant:** `barber`, `receptionist`, `content_manager`
(`Roles.INVITABLE`). Never `admin` or `sysadmin`.

**Where it lives.** `staffInvites/{StaffInviteId}`. The id is an HMAC of
`staffInvite/v1:` plus the parsed, lower-cased email, through a new
`StaffInviteKeyPorts` bundle (shaped like `WalkInKeyPorts`) under a new
secret, `STAFF_INVITE_ID_KEY`. One email has at most one invite document.
Rotating the key orphans at most 7 days of pending invites. Rules:
`allow read, write: if false`.

**Body** (flat; every write is a whole-body Set, so the TTL stamp is
renewed):

- `inviteeEmail`, `inviteeFirstName`, `grantedRoles`, `barberId | null`,
  `inviterUserId`, `inviterFirstName`, `createdAtUtcMs`, `expiresAtUtcMs`,
  `writeOperationId`;
- `staffInviteStatus`: `PENDING`, `ACCEPTED` (with `acceptedAtUtcMs`,
  `acceptedByUserId`) or `REVOKED` (with `revokedAtUtcMs`);
- `staffInviteDelivery`: `NOT_SENT`, `SENT` (with `deliverySentAtUtcMs`) or
  `FAILED` (with `deliveryFailedAtUtcMs`, `deliveryErrorCode`).

**Time rules.** An invite expires 7 days after its last send; "expired" is
computed, never stored. This is the one new elapsed-time rule, added to
`flatten-spec.md` §2.3 T2. Retention: a `staffInvites` group in
`RetentionSystem`, anchored on `acceptedAtUtcMs`, else `revokedAtUtcMs`,
else `expiresAtUtcMs`, plus 30 days; an `anchorOf` case; the `purgeAt`
TTL entry in `firestore.indexes.json`; the TTL counts in
`docs/production-deploy.md`, the runbook §2.1 and `firestore-layout.md`.
The audit rows are the lasting record.

**Creating.** `createStaffInvite` (admin) writes a whole new body when the
document is absent, not `PENDING`, or `PENDING` and expired. It refuses a
`PENDING`, unexpired invite and offers a resend. A query on `barberId`
warns when the barber already has a pending invite to another address; the
link lock decides at accept, so this check is only for the screen. A
double tap is absorbed by `writeOperationId`.

**Sending.**

1. Commit the invite with `NOT_SENT`.
2. Send through `StaffInviteDeliveryPorts = { sendStaffInvite }`. One
   provider adapter may serve login codes and invites
   (`OtpDeliveryPorts & StaffInviteDeliveryPorts`), on the transactional
   stream, never a marketing sender.
3. Write `SENT` or `FAILED`. A failure answers `STAFF_INVITE_SEND_FAILED`
   (retryable); the member page shows «Поканата не е изпратена · Опитай
   пак».

The emulator wires a console sender tagged `@emulatorOnly`; deployed
projects wire a refusing sender tagged `@launchBlocker`, so preflight P8
blocks deploys until the real provider lands. The invite callables bind
`STAFF_INVITE_ID_KEY` and the provider's secret. Logs carry the invite id
and the error code only.

**The email** names the shop, the inviter's first name, the role in words,
the address it was sent to and the expiry date, and links to `/join`. The
link carries nothing. The admin can also copy it and hand it over.

**Who the newcomer is.**

- `provisionAuthUser` sets `emailVerified: true` when it creates a user from
  an email code, since the code proved the address.
- Accept requires `request.auth.token.email` to match the invite and
  `email_verified` to be true. After stage 0, `users.email` has no client
  writer, so accept also compares it.
- Preflight asserts that email-enumeration protection is on, which stops a
  client changing its own Auth email without proof.
- Registration ignores the form's email when the person signed in by email
  (stage 0). The web already sends `Email: null`; only crafted calls change.
- In a phone-code deployment, invites are switched off
  (`STAFF_INVITE_UNAVAILABLE`).

**Finding the invite.** `myStaffInvite` (signed in) computes the id from the
proven email and returns the shop, the inviter's first name, the roles in
words, what they can see, and the expiry, or "none".

**Accepting.** `acceptStaffInvite` runs a new pure `StaffInviteSystem.accept`
in one transaction that reads the invite, the invitee's account, the
inviter's account, the barber record, its lock and the invitee's current
lock. It refuses when:

- the invite is not `PENDING` or has expired;
- the proven email does not match, or is not verified;
- the inviter no longer holds `Roles.ASSIGN`, or is blocked or erased
  (another admin can resend and become the inviter);
- `grantedRoles` is not inside `Roles.INVITABLE`;
- the account is missing, erased, unregistered or a sysadmin (`admitTarget`,
  exported) or blocked (an explicit check, since `admitTarget` does not
  check blocks);
- the account is already linked to another barber record;
- the barber record is missing, `DEPARTED`, or linked to another account.

It writes the union of stored and granted roles (a client stays a client),
the link and its lock, the invite as `ACCEPTED`, and one
`STAFF_INVITE_ACCEPTED` audit row. After the commit it mints a custom token
from the committed roles, writes the `IDENTITY_SESSION_ISSUED` row as
`verifyOtp` does, and returns the token; the web signs in with it.

| Step that fails                                   | Effect                                            | Recovery                                               |
| ------------------------------------------------- | ------------------------------------------------- | ------------------------------------------------------ |
| Commit                                            | Nothing changes                                   | Retry                                                  |
| Token mint                                        | Roles are committed                               | A retry re-mints; the next sign-in carries them anyway |
| Retry on an `ACCEPTED` invite by the same account | Nothing is written; the union is never re-applied | Re-mints the token                                     |

**Revoking.** `revokeStaffInvite` (admin) transacts on the invite, so it
serialises with accept and resend. After acceptance, removing access is a
role change in «Роли».

**Personal data.** Export lists invites matched on `inviteeEmail` (through
the keyed id) and `inviterUserId`. Erasure deletes matching invite
documents, as it already deletes login-code challenges.

### D8. The admin's screens

**Team page.** Read through a `listTeam` callable (admin), which returns
barber records in every status, staff accounts and pending invites, so the
web never reads deny-all collections. Staff accounts come from a
`users.roles array-contains-any` query; its single-field index is switched
back on, with a limit of 200. `TeamRosterSystem.membersOf` returns, per
member:

- **one lifecycle tag**: `DRAFT`, `STAFF_ONLY`, `PUBLIC`, `DEPARTED`, or
  `ROLE_ONLY` for front desk, content editors and admins with no barber
  record (worded with the existing role words);
- **one note**, the first that applies in this order: invite not sent,
  invite expired, invite pending, last day set, no account;
- **done and needed counts** over the D5 bookability items only.

| Tag or note         | Words                                       |
| ------------------- | ------------------------------------------- |
| `DRAFT` with counts | «Подготовка · 3 от 5»                       |
| `STAFF_ONLY`        | «Само за екипа»                             |
| `PUBLIC`            | «Приема записи»                             |
| `DEPARTED`          | «Напусна на 31 дек.»                        |
| invite not sent     | «Поканата не е изпратена · Опитай пак»      |
| invite expired      | «Поканата изтече»                           |
| invite pending      | «Поканата е изпратена · изтича на 20 ноем.» |
| last day set        | «Последен ден: 31 дек.»                     |
| no account          | «Без профил в приложението»                 |

**Add sheet.** Preset; name; shops (multi-shop businesses only); start day;
last day (when the preset needs one); email (when the preset allows one);
«Копирай цените от» (optional). Below the fields, one informational line
when there is an email: «{{name}} ще може да добави снимка и няколко думи
за себе си.» Save creates the `DRAFT` record (barber presets) or only the
invite (non-barber presets), then opens the member page.

**The email check** (`checkStaffInviteEmail`, admin, on the server) has
five answers:

| Answer                                                   | What the sheet offers                                                                     |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| New address (a pending invite folds in as «Изпрати пак») | Invite. A hint: «Провери дали вече не е клиент» with a client search.                     |
| Registered account, not staff                            | «Свържи профил» now, or invite.                                                           |
| Signed in once, never registered                         | Invite. «Влизал е, но не е завършил регистрацията.»                                       |
| Already staff                                            | With a barber link: open their «Роли». Without one: «Свържи профил» onto this new record. |
| Blocked                                                  | Nothing. «Този профил е спрян.»                                                           |

Rehire starts only from a `DEPARTED` row on the Team page.

**Member page.** The checklist with done and needed items, the editors,
the working period, the «Който и да е» toggle («Приема „Който и да е“»),
the account block (invite stage, «Изпрати пак», «Отмени поканата»,
«Копирай връзката», «Свържи профил»), `blockersOf` reasons, «Напускане», and
«Изтрий» for a `DRAFT`.

**«Свържи профил»** runs `setRoles` with the link, which signs the person
out on their devices. The confirmation says so: «{{name}} ще трябва да
влезе отново.»

### D9. The newcomer: way in, setup card, going live

**Steps.**

1. The email arrives; the link opens `/join`, which has no guard.
2. Signed out: «Влез» goes to `/auth?redirect=/join`. With `redirect=/join`
   the identify and code screens use invitee copy: «Влез с имейла, на който
   получи поканата.» and «Провери и папка Спам».
3. A brand-new person registers (phone, first and last name).
   `OnboardingFlowSystem` skips client personalisation when the redirect is
   `/join`. They return to `/join`.
4. `/join` calls `myStaffInvite` and shows the shop, who invited them, the
   role in words and what it can see. «Приеми».
5. Accept returns a token; the app signs in with it. One email code in
   total.
6. Landing by role: front desk → `/staff/schedule`; content editor →
   `/admin/programs`; a barber with empty optional items → the setup card on
   `/staff/schedule`; otherwise `/staff/schedule`.

**States `/join` words.**

- No invite for the signed-in email (this also covers "the invite went to
  another address", which the page cannot know): «Няма покана за {{email}}.
  Ако поканата дойде на друг имейл, отвори връзката на своя телефон или
  излез и влез с него.» A shared-device line before «Излез»: «Ако това е
  общото устройство на салона, отвори връзката на своя телефон.»
- Signed in, not registered: «Довърши регистрацията, за да приемеш
  поканата.» · «Продължи» → `/onboarding?redirect=/join`.
- Expired, revoked, already accepted: one line each; the last links to the
  staff area.

**The setup card** sits at the top of `/staff/schedule` for a linked
barber. It is derived from the barber record; nothing about it is stored on
the server.

| Rows                                               | When they show                                                                    | Can be dismissed                                   | Blocks the app |
| -------------------------------------------------- | --------------------------------------------------------------------------------- | -------------------------------------------------- | -------------- |
| Needed: «Работно време»                            | The record is `DRAFT`, has no hours, and the barber may edit their own hours (O3) | no; «По-късно» hides the card until the next visit | no             |
| Optional: photo, title, bio, Instagram, experience | The field is empty                                                                | yes, «Пропусни» hides the card on this device      | no             |

Why:

- **Bookings never wait on the newcomer by default.** The shop owns
  everything bookability needs. The newcomer is asked only for optional
  details, so the card can be dismissed. This answers the owner's original
  question: the onboarding is dismissible, because nothing in it decides
  whether the person can be booked.
- **The one exception is not dismissible.** If the admin left the hours
  empty, the barber stays unbookable until someone sets them. A dismissed
  row would let that pass unnoticed, so the row can only be postponed.
- **Nothing blocks the app.** A newcomer may need the schedule on day one,
  on a phone, between clients. Account steps (sign-in, registration,
  accept) are the only gate, and they are the existing registration.
- **Optional means optional.** No reminders after «Пропусни». The admin
  sees empty fields as empty on the member page and can fill them.

Dismissal is stored on the device.

**One menu row.** For a linked barber, the existing «Завърши профила си» row
lists the empty barber items instead of the client ones, and the barber
photo counts as the profile photo. No second row.

**Going live.** `activateBarberIfReady` is one idempotent pipeline. In its
own transaction it reads the barber record, the roster and the services,
runs `StaffSetupSystem.checklistOf`, and when every needed item is done
moves `DRAFT` to `barberDraftTargetStatus`, with an audit row. The web
calls it after any editor saves on a `DRAFT` record and when the member
page opens. A failed call leaves `DRAFT`, which is the safe state; the
next call retries. The editors stay unaware of onboarding.

- The member page then says «{{name}} приема записи от 1 декември.»
  (`STAFF_ONLY`: «Екипът може да записва {{name}} от 1 декември.»).
- A barber who is already live when they accept sees: «Клиентите вече
  могат да те записват от 1 декември. Добави снимка и няколко думи за
  себе си.»

### D10. Leaving, coming back, and everyday outcomes

**«Напускане»** (admin, member page).

1. Asks for the last working day.
2. Lists confirmed bookings after that day: the busy days from `barberBusy`
   (queryable by barber and date), then `appointments` by `busyKeys
array-contains` and `bookingStatus` on the existing index. Confirmation
   copy: «След {{date}} {{name}} има {{count}} записа. Остават в графика,
   докато ги преместиш или откажеш.»
3. Writes `barberLastWorkingLocalDate` and a `BARBER_PERIOD_CHANGED` audit
   row. The barber stays bookable and keeps access until that day.
4. A last day already in the past is closed at once by the same pipeline as
   the daily job.

**The daily close** (`closeEndedPeriods`, one `onSchedule` export on the
existing `CRON_TIME_ZONE`, reading the default location's `ShopNow`, as the
other four scheduled jobs do).

- It selects barbers whose last day is **before** today and who are not
  `DEPARTED`, so a missed run is caught up.
- Per barber, one transaction re-reads the record and its last day (an
  extension made just before the run wins), the linked account and the
  lock, and asks a pure `EmploymentSystem.close`. That decision, never
  `RoleAssignmentSystem.decide`:
  - sets the roles to the stored roles minus the staff roles, or
    `['client']` if nothing remains;
  - releases the link and the lock with the exported
    `RoleAssignmentSystem.linkOf`;
  - closes the roster with `ScheduleVersion.closedAt(lastDay)` and drops
    later versions, so analytics stops counting rostered minutes;
  - sets `DEPARTED` with `barberDepartedUserId`, `barberRehireStatus` and
    `barberSessionsRevokedAtUtcMs: null`;
  - writes one audit row credited to the system under a new `SystemSource`,
    `SCHEDULED_JOB`, pointing at the `BARBER_PERIOD_CHANGED` row that set
    the date.
- **If the account holds `admin`**, its roles are left alone and the rest of
  the close goes ahead. The Team page shows «Администратор · махни ролята
  в „Роли“». This protects the last-admin rule.
- **After the commit** it revokes the account's refresh tokens through
  `AuthSessionRevokePorts`, then writes `barberSessionsRevokedAtUtcMs`.
  Every run retries records whose marker is still `null`. This
  deliberately widens the pin that gives the revoke port to `setRoles`
  only (`main.spec.ts`).
- **Residual:** an ID token already issued stays valid for up to an hour
  after the revoke. Stated, accepted.
- **Failures** are isolated per barber, logged as
  `team.period_close_failed { barberId, errorCode }` and
  `team.sessions_not_revoked { barberId }`, both alerted on, and shown on
  the Team page: «Достъпът не е спрян · Опитай пак».

**«Изтрий»** (admin, `DRAFT` only, so only a record that never went live).
One transaction removes the record, its offerings, its roster, any link and
lock, and any pending invite, with a `BARBER_DELETED` audit row.

**«Върни в екипа»** (admin, `DEPARTED` rows). Same record and id: a new
working period, hours prefilled from the last roster version, prices kept,
status back to `barberRehireStatus`. `BARBER_BEFORE_START` blocks bookings
until the new start. Then an invite or «Свържи профил».

**The staff schedule** shows a lane for a `DEPARTED` barber on any day that
has bookings for them.

**Reminder cards.** On the staff home and the Team page, the admin sees a
card for every member whose last day is within 7 days: «Последният ден на
{{name}} е {{date}} · Удължи». A system decides which cards show (none for a
period of 7 days or less). Derived from the record and `ShopNow`; no cron,
no notifications.

**Recipes over existing data (no new states):**

| Outcome                             | How                                                                                                                                     |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Holiday, illness, long leave        | Closed day exceptions (a series of at most 366 days) or a gap in hours. A `LeaveSystem` finds the span; the card reads «В отпуск до …». |
| Guest barber                        | «Гост бръснар»: no account, a required last day.                                                                                        |
| Owner who also cuts hair            | A «Бръснар» with no account. The admin already edits everything.                                                                        |
| Course student drops out            | «Напускане».                                                                                                                            |
| Works at two shops                  | One record, segments at each (D5).                                                                                                      |
| Moves to the other shop             | Change shops and hours.                                                                                                                 |
| Never uses the app                  | No account; fully bookable.                                                                                                             |
| Changes their email                 | A new account (the login email cannot change). The admin moves the link in «Роли»: clear it on the old account, set it on the new.      |
| Front desk or content editor leaves | Remove the role in «Роли».                                                                                                              |
| A mistaken add                      | «Изтрий».                                                                                                                               |

### D11. Data shapes, errors, ports, rules and indexes

**Shapes.**

| Shape                                                 | Kind                     | Notes                                                             |
| ----------------------------------------------------- | ------------------------ | ----------------------------------------------------------------- |
| `BarberLifecycle`                                     | new component            | D2 variants and stamps                                            |
| `barberJoinsAnyPool`                                  | new root field           | boolean                                                           |
| `barberStartsLocalDate`, `barberLastWorkingLocalDate` | new root fields          | `LocalDate`, `LocalDate \| null`                                  |
| `name`, `title`, `bio`                                | changed                  | name stays `LocalizedText`; title and bio `LocalizedText \| null` |
| `handle`                                              | removed or set to the id | D5                                                                |
| `StaffInviteId`                                       | new brand                | `Brand<string, 'StaffInviteId'>` with `parse`                     |
| `StaffInvite`                                         | new entity               | `staffInvites/{id}`, `Collections.StaffInvites`                   |
| `staffInviteStatus`, `staffInviteDelivery`            | new dictionaries         | D7                                                                |
| `BarberBookabilityReason`, `StaffSetupItem`           | new dictionaries         | in `@core/primitives`, since errors carry them                    |
| `Roles.INVITABLE`, `Roles.TEAM`                       | new grant lists          | D7, D5                                                            |
| `SystemSource.SCHEDULED_JOB`                          | new value                | D10                                                               |
| `WriteProvenance` slice                               | added                    | `Barber`, `BarberSchedule`, `Service` (stage 0)                   |

Optional values are `X | null`, never `?:`.

**Systems.** `BarberBookabilitySystem`, `StaffSetupSystem`,
`StaffInviteSystem`, `TeamRosterSystem`, `OfferingCopySystem`,
`EmploymentSystem`, `LeaveSystem`, `TeamReminderSystem`.

**Errors**, in `libs/ecs-core/src/errors/staff-invite.error.ts` and
`team.error.ts`, each parameter added to the wire allowlist:

| Code                                               | When                                                   |
| -------------------------------------------------- | ------------------------------------------------------ |
| `STAFF_INVITE_PENDING_EXISTS`                      | Create over a pending, unexpired invite                |
| `STAFF_INVITE_UNAVAILABLE`                         | Phone-code deployment                                  |
| `STAFF_INVITE_EXPIRED`, `STAFF_INVITE_NOT_PENDING` | Accept or resend on a stale invite                     |
| `STAFF_INVITE_EMAIL_MISMATCH`                      | Proven email does not match or is unverified           |
| `STAFF_INVITE_INVITER_NOT_ADMIN`                   | Inviter lost admin, blocked or erased                  |
| `STAFF_INVITE_ROLE_NOT_INVITABLE`                  | Granted roles outside `Roles.INVITABLE`                |
| `STAFF_INVITE_NOT_REGISTERED`                      | Invitee has not registered                             |
| `STAFF_INVITE_ACCOUNT_BLOCKED`                     | Invitee blocked                                        |
| `STAFF_INVITE_ACCOUNT_LINKED`                      | Invitee linked to another barber                       |
| `STAFF_INVITE_BARBER_UNAVAILABLE`                  | Barber missing, departed, or linked elsewhere          |
| `STAFF_INVITE_SEND_FAILED`                         | Provider refused or failed                             |
| `TEAM_EDIT_FORBIDDEN`                              | Caller may not edit this field or barber               |
| `TEAM_GO_LIVE_INCOMPLETE`                          | Activation asked before the needed items are done      |
| `TEAM_LEAVER_IS_ADMIN`                             | Informational result of the close                      |
| `TEAM_NOT_DEPARTED`                                | Rehire of a record that is not `DEPARTED`              |
| `TEAM_NOT_DRAFT`                                   | Delete of a record that went live                      |
| `TEAM_PHOTO_INVALID`                               | Photo type, size or dimensions refused                 |
| `SCHEDULING_ROSTER_OUTSIDE_SHOPS`                  | Segment at a shop the barber does not work at          |
| `SCHEDULING_ROSTER_DEPARTED`                       | Roster or exception edit on a departed barber          |
| `SCHEDULING_SHOP_HAS_SEGMENTS`                     | Removing a shop that still has segments                |
| `BOOKING_BARBER_NOT_BOOKABLE`                      | Any placement the verdict refuses, with the reason tag |

**Port bundles** (Law 9; one per token or adapter factory; no
`Pick`/`Omit`): `StaffInviteReadPorts`, `StaffInviteWritePorts`,
`StaffInviteDeliveryPorts`, `StaffInviteKeyPorts`, `TeamReadPorts` (the
callable-backed web adapter), `TeamWritePorts`, `MediaCopyPorts`, reusing
`UserLookupPorts`, `CommitPorts`, `ClockPorts`, `AuthAdminPorts`,
`AuthSessionRevokePorts`.

**Rules.**

- `staffInvites`: deny all.
- `barbers/{id}`: read unless `DRAFT`, or staff.
- `scheduleExceptions`: client writes removed (callable only).
- `storage.rules`: `staffUploads/{uid}/{file}` staff write, no read;
  `media/barbers/**` get only.
- A rules integration test covers: the signed-out `== 'PUBLIC'` list, the
  staff `in` list, a client get of a `DRAFT` (denied), a client get of a
  `DEPARTED` (allowed), and an exception write from a client (denied).

**Indexes and TTL.**

- `barbers`: both queries on the existing `(barberStatus, sortOrder)`
  index; stage 0 confirms the `in` query against it.
- `users.roles`: the single-field `array-contains` index switched back on.
- `staffInvites`: `barberId` equality for the screen check; the email
  lookup is a document get.
- TTL: the `staffInvites` group on `purgeAt`.

### D12. Audit, observability and measures

**Audit.** Each callable writes its row inside its commit, credited to the
caller. Governed triggers on `barbers`, `barberSchedules` and `services`
join on `writeOperationId` (the existing pattern for governed collections),
so a write never gets two rows.

| Callable or job             | Audit action                                                                                   |
| --------------------------- | ---------------------------------------------------------------------------------------------- |
| Add                         | `BARBER_ADDED`                                                                                 |
| Profile and photo editors   | `BARBER_PROFILE_CHANGED`                                                                       |
| Shops                       | `BARBER_SHOPS_CHANGED`                                                                         |
| Offerings, copy             | `BARBER_OFFERINGS_CHANGED`                                                                     |
| Hours, breaks               | the existing roster row, now with `operationId`                                                |
| Day exceptions              | `SCHEDULE_EXCEPTIONS_CHANGED`                                                                  |
| Working period, «Напускане» | `BARBER_PERIOD_CHANGED`                                                                        |
| «Който и да е» flag         | `BARBER_POOL_CHANGED`                                                                          |
| Activation, rehire          | `BARBER_STATUS_CHANGED`                                                                        |
| Daily close                 | `BARBER_DEPARTED` (system, `SCHEDULED_JOB`) plus the role change it makes, in one row          |
| Delete                      | `BARBER_DELETED`                                                                               |
| Invites                     | `STAFF_INVITE_CREATED`, `STAFF_INVITE_RESENT`, `STAFF_INVITE_REVOKED`, `STAFF_INVITE_ACCEPTED` |
| «Свържи профил»             | the existing `PROFILE_ROLES_CHANGED`                                                           |

**Logs** (no contact values): `staff_invite.sent`, `staff_invite.send_failed`,
`staff_invite.token_minted`, `staff_invite.token_mint_failed`,
`booking.barber_refused { reason }`, `team.period_closed`,
`team.period_close_failed`, `team.sessions_not_revoked`.

**Measures:**

- time from «Добави» to the first bookable slot;
- share of invites accepted within 7 days (the trigger for adding the
  sign-in hint);
- members still `DRAFT` after 14 days;
- refused bookings by reason (near zero from the web; volume means a
  crafted client or a web bug);
- periods closed late or with a failed revoke (should be zero).

### Cost

At this scale every action is tens of Firestore operations, inside the
free quota (pricing not checked against the current price list).

| Action                                | Reads                                          | Writes                                        |
| ------------------------------------- | ---------------------------------------------- | --------------------------------------------- |
| Add a barber, copying ~10 services    | ~14                                            | ~15, plus audit rows and one capacity rebuild |
| Activation check (only while `DRAFT`) | ~33                                            | 2 when it goes live (status, audit)           |
| Accept an invite                      | ~7                                             | ~5, plus the session row                      |
| Team page (`listTeam`)                | ~130                                           | none                                          |
| Each booking                          | +1 per candidate barber                        | none                                          |
| Daily close                           | 1 query, plus ~4 per closing barber            | ~5 per closing barber                         |
| Reminder cards                        | none extra (derived from records already read) | none                                          |

### Risks

- **The email provider** is a launch blocker for sign-in already. Its daily
  cap and bounce handling are unknown; a bounced invite could suppress
  later login codes to the same address.
- **Rotating `STAFF_INVITE_ID_KEY`** orphans pending invites (at most 7
  days of them).
- **The hour-long residual** of an issued ID token after a leaver's revoke.
- **Bulk setup** rewrites the shared monthly capacity documents in quick
  succession; triggers retry, and the runbook says to add barbers a few
  minutes apart.
- **Not yet verified:**
  - that ID tokens from a custom-token sign-in carry `email` and
    `email_verified` (an Auth-emulator test in stage 3 settles it);
  - that enumeration protection stops a client's own Auth email change for
    custom-token users (same test);
  - that custom-token claims persist across refresh until revoked (the
    `setRoles` design already assumes it);
  - that the staff `in` query is served by the existing index;
  - whether the analytics radars hide barbers with no figures.

### Open decisions (author's call, owner may overturn)

- **O1. Course students and client privacy.** Students get no account by
  default. Before the first student gets one, decide whether a narrower
  role (own agenda only) is needed; it touches the rules, the token claims
  and `role.rules-parity.spec.ts`, and is cheaper before the first course.
- **O2. Going live is always automatic.** No manual hold. If the owner
  wants to review a newcomer first, add «Активиране: Автоматично · Ръчно»
  back.
- **O3. A barber edits their own hours and day exceptions.** Narrower than
  today (anyone edits anyone's). This is also what lets the admin leave the
  hours to a newcomer.
- **O4. Day exceptions move behind a callable** so O3 can be enforced, and
  the front desk keeps editing every roster and exception.
- **O5. Blank English is saved as the Bulgarian text** for barber name,
  title and bio. The alternative is a barber-only type with optional
  English.
- **O6. Plain price copy ships with the first editors**, scaling with the
  student preset. Round 2's structural lens would move all copying to the
  student stage; the author keeps plain copy early because typing every
  price for every new barber is the main chore.
- **O7. Go or no-go on invites** after stages 1a and 1b have been used for
  real. The author's lean is go, because the owner asked for email invites.

### Staging

Each stage is useful on its own. Every exit test names its level.

**0. The lifecycle, enforced everywhere.** One change to `Barber`: the
lifecycle, flag, working period, nullable title and bio, `handle`, and the
`WriteProvenance` slice (also on `BarberSchedule` and `Service`).
`BarberBookabilitySystem` on every path; the verdict-on-placement rule; the
three web reads; the read rule. Registration stops accepting a different
email; `provisionAuthUser` sets `emailVerified`.

Consumers of today's barber stream, and the read each moves to:

| Consumer                                                                   | Read                               |
| -------------------------------------------------------------------------- | ---------------------------------- |
| `/book` (time sheet, schedule, review, bag, confirmed steps), landing page | public                             |
| Staff schedule, staff dashboard, staff visit editor                        | staff                              |
| Staff analytics names and scope                                            | staff, plus `DEPARTED` for history |
| Client card link picker                                                    | staff, plus `DRAFT`                |
| Clients' past visits                                                       | names by id                        |

Inventory (beyond the consumers): `barber-status.data.ts` and five specs;
`catalog.adapter.ts:50`; `apps/functions/src/adapters/firestore-catalog.adapter.ts:107-108`;
`firestore-analytics.adapter.ts:209-213`; `testing/port-doubles.ts:573` and
its spec; `booking-core-entities.type-spec.ts`,
`booking-core-dictionaries.type-spec.ts`; `landing-catalog.ts`; the title
readers `catalog.presenter.ts:135` and `service-detail-sheet.component.html`;
`catalog.fixtures.ts`, `booking-core.fixtures.ts`,
`test-catalog.providers.ts`, `tools/seed-dev-catalog.mjs`,
`apps/web/e2e/support/seed-firestore.ts`; the booking pipeline specs (book,
reschedule, edit, read set), which must now seed barbers;
`registration.system.spec.ts:668-686` and the docstring at
`registration.system.ts:113-118`; `firestore.rules.integration.spec.ts`;
`docs/production-deploy.md` §2, `firestore-runbook.md:28`,
`flatten-spec.md:741`, `designs/staff-analytics.md:447`. The seed's three
barbers become `PUBLIC`, in the pool, with a period from the seed date.

Deploy order: indexes, rules, functions and hosting together. Rolling back
needs the data rolled back too.

**Exit tests:**

- unit: `verdictOf` and `blockersOf` over every reason, purity;
- rules integration: the five D11 cases;
- emulator e2e: flipping seed barbers to `DRAFT`, `STAFF_ONLY` and
  `DEPARTED` removes them from `/book`, its prices and its free time; the
  staff grid still shows `STAFF_ONLY`; a crafted booking before the start
  day, after the last day, on a `DRAFT`, or for an out-of-pool barber under
  «Който и да е» is refused with the right reason; a crafted registration
  with another email is refused.

**1a. The Team page and the editors.** `listTeam` and the `users.roles`
index; the add sheet (barber presets); the member page; profile, photo,
shops, services with plain copy, hours (narrowed), `setDayExceptions`,
working period; `activateBarberIfReady`; «Изтрий»; permissions (D5);
audit (D12); «Свържи профил» with a client lookup and the copy «Помоли
{{name}} да влезе веднъж в приложението. После натисни „Свържи профил“.»;
«Рецепция» and «Съдържание» through «Роли». Every new callable changes the
pinned export, registry, secret and App Check tables in `main.spec.ts`.

- **Exit test (emulator e2e):** on a fresh emulator an admin adds a barber,
  copies prices and sets hours; the barber goes live with no console write;
  a client books them on `/book`; a barber cannot change another barber's
  hours or exceptions.

**1b. Leaving and coming back.** «Напускане» with the leftover list;
`closeEndedPeriods` and the immediate close; the revoke and its marker;
«Върни в екипа»; the leftover lane; reminder cards; the
`SCHEDULED_JOB` source and the widened revoke pin.

- **Exit test (functions integration spec with a pinned now, after the
  `set-roles.integration.spec.ts` precedent):** after the close the roles,
  link, lock and roster changed, `tokensValidAfterTime` moved, the marker
  is set, and a second run changes nothing; a simulated revoke failure is
  retried on the next run. **Emulator e2e:** a last day already in the past
  closes at once and the leaver's next request is refused.

**Gate: O7.** Decide on invites after 1a and 1b are in use.

**2. Launch track, in parallel: the real email provider.** Unblocks sign-in
in production and, later, invites. One sending domain with SPF, DKIM and
DMARC; one transactional stream for codes and invites.

**3. Staff invites and the setup card.** `staffInvites`, the key, delivery,
TTL, export and erasure; `checkStaffInviteEmail`, create, resend, revoke,
`/join`, `myStaffInvite`, accept with the token mint; the invitee copy and
the personalisation skip; the setup card and the single menu row.

- **Exit tests:** Auth-emulator: an account that changes its own Auth email
  through REST is refused at accept; custom-token ID tokens carry `email`.
  Emulator e2e: an invite to a new address is "sent" by the console sender;
  the person signs in with one code, registers, accepts and lands on the
  staff schedule with the setup card; someone who signs in with another
  address and registers with the invited one is refused; a revoked or
  expired invite is refused.

**4. Course students and guest barbers.** The two presets, scaled copy and
lengthened durations, the privacy warning, «Завърши обучението».

- **Exit test (emulator e2e):** a student added with scaled prices is
  bookable by the front desk only, never given to a «Който и да е» client,
  and the admin sees the reminder card seven days before the last day.

**Later:** moving a leaver's future bookings; email bounce tracking; the
sign-in invite hint if the measure calls for it; a narrower student role
(O1); a manual go-live mode (O2).
