# Goldfish Brainstorm Findings: Team onboarding

**Target:** `concepts_brief.md` (lines 1-334), the first draft. That brief is now `docs/designs/team-onboarding.md`; line numbers below refer to the draft as reviewed, not to the published file.
**Mode:** BRAINSTORM
**Date:** 2026-11-13

## Reviewer Status

| Reviewer                       | Lens title                                        | Status    |
| ------------------------------ | ------------------------------------------------- | --------- |
| `egm-design`                   | Skeptical Architect Brainstormer                  | completed |
| `egm-codebase-details`         | Codebase Grounding and Observability Brainstormer | completed |
| `egm-zoom-out`                 | Contrarian / YAGNI Brainstormer                   | completed |
| `egm-comprehension`            | UX & Ergonomics Brainstormer                      | completed |
| `egm-implementation-readiness` | Migration & Rollout Brainstormer                  | completed |
| `egm-structural`               | Maintainability & Tech Debt Brainstormer          | completed |

## Severity count

| Severity | Count |
| -------- | ----- |
| Blocker  | 5     |
| Major    | 28    |
| Nit      | 11    |

## How to read this

- Line numbers in "Affected scope" refer to `concepts_brief.md`. Code paths
  are relative to the repository root.
- Each finding lists every lens that raised it. Where reviewers gave it
  different severities, the finding says so.
- The synthesizer checked the claims most findings rest on against the code
  (list at the end). The other code citations come from the reviewers.

## Answers to the lens questions

1. **Is "highly configurable" earned?** Only in part. Most of the new
   settings repeat data that already exists or have nothing that reads them.
   The apprentice label is `BarberMeta.title`. Start and end dates are
   already on the roster. Lower prices are ordinary offerings. The supervisor
   and the course link have no reader. The three booking axes give 12 stored
   combinations, and only 5 of them mean something. The outcomes a shop
   actually meets (leave, a guest barber, rehire, two locations, an owner who
   also cuts hair) mostly need written recipes over existing data, not new
   switches. Recommended shape: one lifecycle field, one "any barber" flag,
   one employment window on the barber record, and presets as default values
   only. See M2, M4, M14, M15 and M23.
2. **Natural outcomes missed or mishandled.**
   - A leaver keeps access to every client record (M1).
   - Rehire loses the gap between employments and can be blocked by the link
     lock (M1, M2, M23).
   - Leave of absence, guest barbers and an owner who also cuts hair are not
     covered (M23).
   - Two locations has two sources of truth (M7).
   - A barber with no account cannot go live (M5).
   - An email mismatch creates a second account (M22).
   - An apprentice's end date passes silently, and dropping out is not
     covered (M15).
3. **Are three dismiss tiers justified?** Not as written.
   - Tier 1 is what registration already does.
   - Tier 2 holds only the weekly hours, because the name is always typed at
     «Add». It becomes empty if hours are made admin-owned.
   - Tier 3, optional profile fields skipped for good, holds up.

   See M4.

4. **Is `barberStatus` / `bookingAccess` / any-barber the right set?** No.
   The axes are not independent (M2), and the server enforces none of them
   (B2). The start date and last day cannot live on roster versions (B1).
5. **Invite security.**
   - The identity proof is not sound (B5).
   - Acceptance does not re-check the inviter (B3).
   - A co-owner invite to a mistyped address hands over admin (M11).
   - The pre-sign-in page and decline need a redacted callable and random
     ids (M10).
   - The roster gate already lets any staff member rewrite any roster (M9).
   - Departure keeps access (M1), and apprentices read every client
     profile (M16).
   - The admin-only email check adds no exposure beyond what admins already
     have (M10).
6. **Is the staging order buildable?** No.
   - Stage 1 is a launch blocker, not a build dependency.
   - Stage 2 creates barbers before DRAFT exists.
   - Stage 3 hides changes to the booking core.
   - Leaving comes after the stages that need it.

   See M26.

## Where reviewers disagreed, and the recommendation

| Question                                       | Positions                                                                                                                                                               | Recommendation                                                                                                                                  |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Where the start date and last working day live | Codebase, comprehension, implementation-readiness, structural: flat fields on the barber record. Design, zoom-out: keep them on the roster and add roster operations.   | Barber record. The bookability check loads the barber anyway (B2), and the roster then holds hours only (B1).                                   |
| Capacity with the new states                   | Design, codebase: a `barbers/*` trigger plus a status filter in the rebuild. Implementation-readiness, structural: keep the projection roster-based and filter at read. | Filter at read for `/book` (`CapacityEntry.freeMinutesOn` already takes barber ids). Add a trigger only if exact public totals are needed (B2). |
| Which email proves identity at accept          | Design: the Firebase Auth user record's email. Implementation-readiness: the stored `users.email`.                                                                      | Auth user record. The synthesizer confirmed that the registration form can overwrite `users.email` before registration (B5).                    |
| How accept reuses role assignment              | Four lenses: a new `StaffInviteSystem.accept`. Zoom-out: call the existing `decide` with the inviter as caller and the union of roles.                                  | A new system. The zoom-out route works but still needs an invite-specific audit action (B3).                                                    |
| Revoke sessions after accept                   | Codebase, structural, implementation-readiness: mint a token, revoke the other sessions. Zoom-out: no revoke, because a grant only widens rights.                       | Mint a token. Revoking is optional (B4).                                                                                                        |
| Keep DRAFT                                     | Most lenses: keep. Zoom-out: derive "setting up" and "left" from the roster.                                                                                            | Keep DRAFT as one variant of a single lifecycle field (M2).                                                                                     |
| Build invites at all                           | Zoom-out: stage 2 plus «Свържи акаунт» removes the console step. Comprehension: richer `/join` states and copy.                                                         | Decide after stage 2 is in use, and pick one level of invite (M14).                                                                             |
| Severity of departure                          | Implementation-readiness: Blocker. Others: Major.                                                                                                                       | Major, first in the Major list (M1).                                                                                                            |
| Severity of the setup ledger on the invite     | Structural: Blocker. Others: Major.                                                                                                                                     | Major (M3).                                                                                                                                     |
| Severity of the session step                   | Four lenses: Blocker. Design, zoom-out: Major.                                                                                                                          | Blocker (B4).                                                                                                                                   |

---

## Prioritized Findings (Blockers -> Major -> Nits)

## Blockers

### B1. The start date and the last working day cannot live on the roster's version dates - Severity: Blocker

- **Reviewer Lens:** `egm-design`, `egm-codebase-details`, `egm-zoom-out`, `egm-comprehension`, `egm-implementation-readiness`, `egm-structural`
- **Affected Scope:** D5 (lines 255-258); D3 table (lines 200-201, 208-211); D2 (line 178); D6 (lines 266-270)
- **Discrepancy Description**:
  - **They are per-version dates.** `effectiveFromLocalDate` and
    `effectiveToLocalDate` are the validity window of one roster version,
    and a barber has several versions (`barber-schedule.entity.ts:21-22`).
    They are not a hire date and a last day.
  - **Every hours save overwrites them.** The hours editor saves through
    `ScheduleVersion.replaceFrom`. It drops every version that starts on or
    after the save day and always appends an open-ended version
    (`schedule-version.data.ts:196-226`). `amend` also appends an open-ended
    version (`:134-140`). No code writes a final end date. So:
    - the first hours save after a last working day, or after an
      apprentice's end, silently reopens the roster;
    - a save dated before a future start moves the start earlier.
      `setFrom` refuses only past days (`roster-week.system.ts:248-271`),
      and the sheet's «В сила от» defaults to today
      (`libs/features/staff/dashboard/src/lib/staff-hours-sheet/staff-hours-sheet.ts:129`).
  - **The start date has no home when hours are delegated.** If the admin
    leaves the hours to the newcomer, no roster exists to hold the start
    date. D3 says the start date cannot be left to the newcomer.
  - **Rehire.** After a rehire, the first version's start is the original
    hire date.
  - **Duplicate.** `apprenticeEndsLocalDate` and "roster ending on the end
    date" are two copies of one date.
- **Rationale & Recommendation**:
  - Store the employment window as flat, admin-owned root fields on the
    barber record: `barberStartsLocalDate` and
    `barberLastWorkingLocalDate: LocalDate | null`. Make the apprentice end
    either that same field or a review date only.
  - Booking, availability, the waitlist and capacity read the window
    through the bookability system (B2), which loads the barber record
    anyway.
  - Roster editors clamp to the window, or refuse with a new code such as
    `SCHEDULING_ROSTER_OUTSIDE_EMPLOYMENT`.
  - Drop "No new field" from D5. State each date once, in D5, and refer to
    it from D2, D3 and D6.
  - **Alternative (design, zoom-out):** keep the dates on the roster. That
    requires:
    - `ScheduleVersion.startOn` and `endAfter` operations;
    - a `replaceFrom` that keeps an existing end;
    - an empty-week version written at «Add»;
    - the done check "a version has a segment".
  - Either way, ship the fix in the first stage that sets dates, not in
    stage 7.

### B2. None of the new states is enforced on the server - Severity: Blocker

- **Reviewer Lens:** `egm-design`, `egm-codebase-details`, `egm-zoom-out`, `egm-comprehension`, `egm-implementation-readiness`, `egm-structural`
- **Affected Scope:** D5 (lines 238-262); D6 (lines 269-272); Staging step 3 (lines 328-329)
- **Discrepancy Description**:
  - **Booking never reads the barber record.** `readBookingSet` reads the
    location, services, `barberSchedules` and customers, and never
    `barbers/{id}` (`booking-read-set.pipeline.ts:156-192`). Book,
    reschedule and edit all use it. Among the pipelines, only `setRoles`
    reads `barbers` (`set-roles.pipeline.ts:119, 203`). `barberStatus` is
    only a catalogue query filter (`catalog.adapter.ts:46-53`;
    `apps/functions/src/adapters/firestore-catalog.adapter.ts:104-109`). A
    crafted call can book a DRAFT, DEPARTED or STAFF_ONLY barber, and
    barber ids are public.
  - **Staff bookings skip the roster.** Staff placement skips the roster,
    shop hours, horizon and future-start rule
    (`placement-policy.data.ts:34-39`; `booking-decision.system.ts:702-707`).
    "Bookings before that day are impossible because there are no hours"
    (line 256) is false for staff, which is exactly the STAFF_ONLY
    apprentice case.
  - **The "any barber" pool has no per-barber input.** Under ANY,
    `BarberPref.matches` accepts every barber (`barber-pref.data.ts:47-53`,
    called at `availability.system.ts:414`).
  - **Capacity counts rosters, not live barbers.** Its population is every
    barber with a roster (`scheduling.port.ts:355-362`;
    `firestore-schedules.adapter.ts:118-129`), and no trigger fires on
    `barbers/*` writes (`main.ts:1037-1098`). A DRAFT barber whose hours
    are set adds public free capacity. "Bookable by the person asking"
    (line 260) cannot live in one shared projection.
  - **Public prices count every offering, whatever the status.** This
    covers the «от» price, the card price and the any-barber span
    (`catalog-pricing.system.ts:82-109`; `offering-price.system.ts:136-162`;
    `terms-span.system.ts:76-85`). A DRAFT apprentice priced at 60% lowers
    the public price at once.
  - **A barber with no offering can still be booked.** `termsFor` falls back
    to catalogue terms (`offering-price.system.ts:60-77`), and
    `isPerformedBy` runs only in the web services step.
  - **The waitlist matcher** takes every ACTIVE barber
    (`match-waitlist.pipeline.ts:165-185`).
  - **One ACTIVE-only web stream feeds four screens:** `/book`, the staff
    grid, the staff dashboard and client visit names
    (`catalog-content.service.ts:58-75`; `staff-day.store.ts:1114-1119`).
    Filtering it to EVERYONE would drop STAFF_ONLY barbers from the staff
    grid.
- **Rationale & Recommendation**:
  - Add one pure system, for example
    `BarberBookabilitySystem.bookableBy(barber, askerTier, barberPreference, localDate)`.
    Every decision path calls it:
    - book, reschedule and edit;
    - availability and the any-barber pool;
    - the waitlist matcher;
    - price tiles, spans and performer lists;
    - capacity readers and the lead-time sampler.
  - Add `barbers/{id}` for each named barber, or for the any-barber pool, to
    the `readBookingSet` batch. That is k extra reads, with k at most the
    staff count. Refuse with `BOOKING_BARBER_NOT_BOOKABLE`, and add a
    server-side `isPerformedBy` refusal.
  - Split the web read into a public list, a staff list and by-id names for
    history. Declare the composite index if the public query gains a filter.
    Today's index is `barberStatus, sortOrder`
    (`firestore.indexes.json:17-30`).
  - **Capacity:** keep the projection roster-based. `/book` filters entries
    by its eligible barber ids (`capacity-entry.data.ts:66-82`), and the
    lead-time sampler leaves out barbers who are not eligible. Add a
    `barbers` trigger that fires only on eligibility fields if exact public
    totals are required.
  - List every file in Staging step 3.

### B3. Accepting the invite cannot reuse `RoleAssignmentSystem.decide` as described - Severity: Blocker

- **Reviewer Lens:** `egm-design`, `egm-codebase-details`, `egm-zoom-out`, `egm-comprehension`, `egm-implementation-readiness`, `egm-structural`
- **Affected Scope:** D1 (lines 171-174); D7 (lines 296-299); D8 (lines 312-313, 319-320); Analysis (lines 88-93)
- **Discrepancy Description**:
  - **`decide` refuses every acceptance.** It admits only a caller whose
    stored roles hold `Roles.ASSIGN`, and refuses `target === caller`
    (`role-assignment.system.ts:196-206`). At accept time the invitee is
    both.
  - **It would drop `client`.** `changeOf` replaces the role set
    (`set-roles.pipeline.ts:137`), so granting `['barber']` removes
    `client`. That contradicts lines 90-92.
  - **The audit row names the wrong person.** It credits the caller
    (`set-roles.pipeline.ts:247`), so it would read as a client granting
    themselves admin.
  - **The inviter is not re-checked.** An admin demoted after sending still
    grants admin for up to 7 days, and longer with resends.
  - **Two invites can target one barber.** Pending invites are refused only
    per email, not per barber record, and the link lock is taken only at
    acceptance.
- **Rationale & Recommendation**:
  - Add a pure `StaffInviteSystem.accept`, and export `admitTarget` and
    `linkOf` so it can reuse them.
  - In one transaction, read:
    - the invite and `users/{invitee}`;
    - `users/{inviterUserId}`;
    - the barber, its link lock, and the invitee's current lock.
  - Refuse when:
    - the invite is not PENDING, or has expired at `nowUtcMs`;
    - the proven identity (B5) does not match;
    - the inviter no longer holds `ASSIGN`, or is blocked or erased;
    - `grantedRoles` is not inside `Roles.ASSIGNABLE`;
    - the target fails `admitTarget`. It requires REGISTERED, so a new
      person goes OTP, then registration, then accept;
    - the barber is DEPARTED or missing.
  - Write the union of stored and granted roles, the link and its lock, and
    the ACCEPTED status. Add one `STAFF_INVITE_ACCEPTED` audit row naming
    the invitee, the inviter, the roles before and after, and the link.
  - Refuse a second pending invite for the same `barberId`. Map
    `GOVERNANCE_ROLES_BARBER_ALREADY_LINKED` to an invite-specific code.
  - Revoke, resend and accept all transact on the invite document, so they
    serialise.
  - State what happens to outstanding invites when the inviter loses admin.
  - **Zoom-out alternative:** pass the inviter as caller to `decide`, with
    the union as the requested set. `decide` stays unchanged, but the audit
    row still needs an invite action.

### B4. "Sessions are refreshed, as `setRoles` does today" is wrong: `setRoles` signs the person out - Severity: Blocker

- **Reviewer Lens:** `egm-codebase-details`, `egm-comprehension`, `egm-implementation-readiness`, `egm-structural` (Blocker); `egm-design`, `egm-zoom-out` (Major)
- **Affected Scope:** D7 (lines 305-306); D4 (lines 215-220); Staging steps 4-5 (lines 330-331)
- **Discrepancy Description**:
  - **`setRoles` revokes sessions.** It calls `revokeRefreshTokens`
    (`set-roles.pipeline.ts:287-301`; `identity.port.ts:256-266`). Roles
    reach the token only when `verifyOtp` or `completeRegistration` mint a
    custom token (`verify-otp.pipeline.ts:277-284`;
    `complete-registration.pipeline.ts:285-296`;
    `docs/production-deploy.md:762-764`). The shipped copy says «Ролите са
    запазени. Важат от следващото влизане.» (`bg.json:2294`).
  - **What the newcomer would see if accept copied it:**
    1. Their token still says `client`.
    2. The staff route under `rolesGuard(...Roles.STAFF)`
       (`apps/web/src/app/app.routes.ts:137`) sends them to `/forbidden`.
    3. `SessionExpiryService` then signs them out
       (`apps/web/src/app/shell/session-expiry.service.ts:37-50`).
    4. They need a second OTP email, subject to the resend window.
  - **Result:** onboarding becomes an invite email, then an OTP, then
    another OTP.
- **Rationale & Recommendation**:
  - After the commit, the accept callable mints a custom token from the
    committed roles (`AuthAdminPorts.mintCustomToken`) and returns it, as
    `completeRegistration` does. The web signs in with it before opening
    setup.
  - For a brand-new person, consider granting the accepted invite inside
    `completeRegistration`, so one token covers both steps.
  - Revoking the other sessions is optional. If you keep it, revoke before
    minting, and test the granularity of `tokensValidAfterTime` in the Auth
    emulator (unverified).
  - Failure handling:

    | Step that fails                             | Effect              | Recovery                      |
    | ------------------------------------------- | ------------------- | ----------------------------- |
    | Commit                                      | Nothing changes     | Retry                         |
    | Mint                                        | Roles are committed | The next sign-in carries them |
    | Retry by the same uid on an ACCEPTED invite | No-op               | Re-mints the token            |

  - Log `staff_invite.token_minted`, and its failure.
  - Rewrite line 305.

### B5. The invite is matched against an email that nothing has proven - Severity: Blocker

- **Reviewer Lens:** `egm-design` (Blocker), `egm-implementation-readiness`, `egm-structural`; confirmed by the synthesizer
- **Affected Scope:** D7 (lines 296-302); D1 (lines 171-174); Alternatives, bearer-token item (lines 144-147); D8 co-owner (lines 319-320)
- **Discrepancy Description**:
  - **No account has a verified email flag.** Auth users are created
    without `emailVerified`
    (`apps/functions/src/adapters/auth-claims.adapter.ts:89-95`). The
    token's `email_verified` is false for everyone, so a check on it
    refuses every accept.
  - **The registration form can set the stored email.** Before
    registration, `RegistrationSystem.settle` writes the form's email
    (`registration.system.ts:158-168`), and a field the form sent is kept
    as sent (`:119-126`).
  - **The attack:**
    1. Someone signs in with their own address.
    2. They submit registration with the invitee's address.
    3. They now match the invite, the sign-in pending-invite query, and the
       "has an account" check, which queries `users.email`
       (`identity.port.ts:98-107`).

    With a co-owner invite, this ends in admin takeover. Whether the web
    form sends the Email field under email OTP is unverified; the callable
    accepts it either way.

  - **Matching stored `users.email` is unsafe.** Implementation-readiness
    recommended it; the attack above rules it out.
  - **Phone sign-in proves no email.** Under `PhoneOtp`
    (`auth-strategy.data.ts:14-18`), no email is proven at all.
- **Rationale & Recommendation**:
  - Define the proof as the Firebase Auth user record's email:
    `request.auth.token.email` in a callable, or `getUser(uid).email`
    behind a new port. `provisionAuthUser` sets it only from the address
    that passed OTP, and no contact-change path exists.
  - Never match on `users.email` or `email_verified`.
  - Pin the login channel on first registration: under the email channel,
    ignore the form's Email field.
  - Run the pending-invite lookup on the server, keyed by the proven email.
  - State that a phone-OTP deployment supports only account-bound
    (client-card) invites.
  - Confirm in the Auth emulator that tokens from custom-token sign-in carry
    `email` (unverified).

---

## Major

### M1. Departure leaves staff access, the flip date and future bookings undefined - Severity: Major

- **Reviewer Lens:** `egm-implementation-readiness` (Blocker), `egm-design`, `egm-codebase-details`, `egm-zoom-out`, `egm-comprehension`, `egm-structural`
- **Affected Scope:** D5 DEPARTED (lines 244-246, 258); Goals (lines 113-114); Non-goals (lines 129-130); D8 (line 321); Staging step 7 (line 333)
- **Discrepancy Description**:
  - **Access stays after leaving.** DEPARTED is a field on `barbers/{id}`,
    while roles live on `users/{uid}`. The account keeps `barber`, so
    `worksTheBook()` still reads every appointment and client profile
    (`firestore.rules:54-56, 209, 299`). Leaving arrives at stage 7, after
    the first leaver.
  - **Nobody flips DEPARTED on the day.** Flipping early delists a barber
    who is still working. A cron that writes it stores a derived value.
  - **The brief contradicts itself.** The non-goal at lines 129-130 excludes
    reassigning bookings; stage 7 includes it.
  - **Remaining bookings disappear from staff view.** The staff grid builds
    lanes from ACTIVE barbers only (`staff-day.store.ts:1114-1119`).
    `appointments` cannot be queried by barber, because the `barberIds`
    indexes are off (`firestore.indexes.json:459-463`). `barberBusy` by
    barber and date range can be (`rebuild-capacity.pipeline.ts:119-137`).
  - **Erasure is blocked.** It refuses an account that holds a staff role
    (`client-erasure.system.ts:331-351`).
  - **Rehire is unsafe.** Future roster versions come back, and the link
    lock can block re-linking (`role-assignment.system.ts:245-249`).
- **Rationale & Recommendation**:
  - Ship one «Напуска» pipeline with the first editors. It asks for the last
    day, and the barber stays bookable until then (B1).
  - On the last day (at once if it is past, otherwise by the daily sweep) it
    does, with one audit row:
    - removes staff roles through the `setRoles` decision, which clears the
      link and the lock (`role-assignment.system.ts:252-253, 307-314`);
    - drops roster versions after the last day;
    - sets DEPARTED.
  - Before confirming, it lists confirmed bookings after the last day from
    `barberBusy`, and refuses or asks for acknowledgement. Reassignment can
    come later.
  - The staff grid shows the lane of a barber who is not ACTIVE on any day
    that has a busy document.
  - Resolve the non-goal versus stage 7 contradiction.
  - Rehire is a new window plus a new invite or a `setRoles` call. Prefill
    the old hours and prices.

### M2. `barberStatus`, `bookingAccess` and "any barber" are not independent - Severity: Major

- **Reviewer Lens:** `egm-design`, `egm-zoom-out`, `egm-structural`, `egm-comprehension`
- **Affected Scope:** D5 (lines 238-262); Analysis (lines 55-60); Alternatives (lines 151-156); D6 (lines 271-272)
- **Discrepancy Description**:
  - **Most combinations mean nothing.** `bookingAccess` and "any barber"
    mean something only in ACTIVE. DRAFT × EVERYONE and DEPARTED ×
    STAFF_ONLY have no meaning: of 12 stored combinations, 5 are
    meaningful.
  - **"Listed publicly" is a hidden third concept.** D6 implies STAFF_ONLY
    hides the public card; D5 never says so. Because the query filters only
    `barberStatus`, an ACTIVE STAFF_ONLY barber would appear on `/book` and
    on «Екип».
  - **"Temporarily off" disappears.** Removing INACTIVE leaves no
    replacement (`barber-status.data.ts:9-12`).
  - **Rehire erases the gap.** No variant carries a stamp, and the
    variant-transition rule deletes the old fields, so DEPARTED → ACTIVE on
    the same record leaves no trace of the gap.
- **Rationale & Recommendation**:
  - Use one lifecycle field with a variant per state:
    `barberStatus: DRAFT | STAFF_ONLY | PUBLIC | DEPARTED`.
    - Each variant carries its entering stamp (`barberActivatedAtUtcMs`,
      `barberDepartedAtUtcMs`, ...).
    - The go-live check runs on leaving DRAFT.
    - The public query stays one equality on the existing index.
  - Keep "any barber" as one setting, meaningful only in STAFF_ONLY and
    PUBLIC.
  - Model leave as data, not a state (M23).
  - Add a table of each state against: the public team page, the `/book`
    picker, the «Който и да е» pool, the staff grid, clients' past visits,
    and price quotes.
  - **Zoom-out alternative:** drop DRAFT and derive "setting up" and "left"
    from the employment window.

### M3. The "left to them" and "skipped" items are stored on the invite, which is the wrong owner - Severity: Major

- **Reviewer Lens:** `egm-structural` (Blocker), `egm-design`, `egm-codebase-details`, `egm-comprehension`, `egm-zoom-out`
- **Affected Scope:** D3 (lines 208-211); D2 (lines 179-182); D4 (lines 231-233); D7 (lines 287-292); D8 (line 316)
- **Discrepancy Description**:
  - **The two lifetimes differ.** The invite expires in 7 days, the TTL
    deletes it 30 days later, it is never transferred, and it does not exist
    for a barber with no account. The setup ledger outlives all of that.
  - **The consequences:**
    - a no-account barber's "not needed" has no home;
    - the TTL deletes the delegation while the DRAFT record remains;
    - a revoke-and-reinvite after a typo has to copy the ledger;
    - tier-3 skips after acceptance mutate an ACCEPTED invite indefinitely;
    - a rehire drops earlier skips;
    - the newcomer cannot read an admin-only invite to see their own list.
- **Rationale & Recommendation**:
  - Key the ledger by `BarberId` in a staff-only document. Either:
    - `barbers/{id}/restricted/setup`, a named document with its own rules
      match, like `restricted/link`; or
    - `teamSetup/{barberId}`.
  - Write it only through a callable; the admin and the linked barber can
    read it.
  - Hold three tag arrays from one `StaffSetupItem` dictionary:
    `setupDelegatedItems`, `setupWaivedItems` and `setupSkippedItems`, with
    `fieldOverrides` entries.
  - The invite then keeps only the offer, so any non-accepted invite can be
    purged with no loss. Or cut the triage entirely (M4).

### M4. The per-item triage and the three dismiss tiers do not hold up - Severity: Major

- **Reviewer Lens:** `egm-zoom-out`, `egm-comprehension`, `egm-structural`
- **Affected Scope:** Goals (lines 100-102); D2 (lines 178-182); D3 (lines 191-211); D4 (lines 213-236)
- **Discrepancy Description**:
  - **The triage is heavy on a phone.**
    - It is eight rows with three choices each.
    - Four rows (shops, services, start date, roles) have only one legal
      answer.
    - "Fill now" opens editors keyed by a `barberId` that does not exist
      until Save.
    - Only the apprentice preset's defaults are stated.
    - "Leave to them" with no email leaves the item to nobody.
  - **Tier 2 is only the hours.** The name is typed at «Add», and `handle`
    is required (`barber.entity.ts:15-18`), so the tier-2 name item can
    never be pending. If hours become admin-owned, tier 2 is empty.
  - **Tier 1 adds nothing new.** It is what registration already enforces:
    `setRoles` refuses unregistered targets.
  - **No copy separates the tiers.** Nothing tells postpone apart from
    skip, and the admin sees skipped items as empty.
  - **A DRAFT newcomer has no column on the staff day sheet.** The sheet is
    built from the ACTIVE-only catalogue (`staff-dashboard.ts:769-774`),
    which weakens the "just see their schedule" argument (line 223).
- **Rationale & Recommendation**:
  - **The add sheet:**
    - It asks only for preset, name, email and start date.
    - It then shows one summary line from the preset: «Иван ще попълни:
      часове, снимка, представяне · Промени».
    - Save creates the DRAFT and opens the member page. Its checklist is the
      triage, with an owner («Ти» / «Иван») on each row.
    - Add a table of rows × presets giving each row's default owner.
    - Disable "leave to them" when there is no email.
  - **The newcomer's screen has two groups:**
    - «Нужно, за да те записват», with one screen-level «По-късно»;
    - «По желание», with «Пропусни» on each row.

    The admin sees «Пропуснато» as distinct from «Празно».

  - Decide whether hours can be delegated. If they cannot, reduce the flow
    to one dismissible card for optional profile fields (zoom-out).
  - The tier rule is a system decision (Law 10.2), not a presenter's.

### M5. "Roles: needed to go live" blocks every barber without an account - Severity: Major

- **Reviewer Lens:** `egm-design`, `egm-codebase-details`, `egm-zoom-out`, `egm-comprehension`, `egm-implementation-readiness`, `egm-structural`
- **Affected Scope:** D3 (line 202); D5 (lines 247-248); D8 (line 316); Alternatives (lines 140-143)
- **Discrepancy Description**: Roles live on `users/{uid}`
  (`user.entity.ts:26-27`). «Пусни» would refuse the no-account barber that
  D8 calls fully supported.
- **Rationale & Recommendation**:
  - Going live requires a name, at least one offering, and a roster segment
    inside the employment window.
  - Roles are required only when an account is linked or an invite is
    pending. Otherwise the row shows "not applicable".

### M6. The `Barber` shape cannot hold the draft D3 describes - Severity: Major

- **Reviewer Lens:** `egm-structural`, `egm-comprehension`, `egm-design`, `egm-zoom-out`, `egm-implementation-readiness`, `egm-codebase-details`
- **Affected Scope:** D2 (line 178); D3 (lines 195-197, 208-210); D4 (lines 231-233)
- **Discrepancy Description**:
  - **Required fields.** `name`, `title` and `bio` are non-null
    `LocalizedText`, which requires non-blank `bg` and `en`
    (`barber.entity.ts:15-19`; `localized-text.data.ts:5-34`). `handle`
    must be non-blank (`barber.entity.ts:16-17`) and `sortOrder` is
    required; neither is in D3.
  - **What follows:**
    - a DRAFT with the name left to the newcomer cannot be stored;
    - "name is non-blank" can never be false;
    - title and bio cannot be skipped for good;
    - the newcomer would have to write everything in two languages;
    - "prefilled from the account" must turn one `firstName`/`lastName`
      pair into two locales.
  - **Two answers.** D2 asks for the name, while D3 lets it be left to the
    newcomer.
- **Rationale & Recommendation**: Add a field-level table that settles:
  - the name is required at «Add», and the newcomer may edit it;
  - `title` and `bio` become `LocalizedText | null` for barbers;
  - Bulgarian only, with English falling back to it, or the admin owns
    `en`;
  - `handle` comes from the name by a named slug rule with a uniqueness
    check;
  - the admin sets `sortOrder`.

  Update the `tools/seed` fixtures in the same change.

### M7. "Shops they work at" has two sources; one person at two locations is unstated - Severity: Major

- **Reviewer Lens:** `egm-codebase-details`, `egm-comprehension`, `egm-structural`, `egm-zoom-out`, `egm-design`
- **Affected Scope:** D3 (lines 198, 200, 208-210)
- **Discrepancy Description**:
  - **Empty is ambiguous.** An empty `Barber.locationIds` means every
    location (`barber.entity.ts:9-10`; `location-scope.system.ts:29-32`),
    so a done check cannot tell "not set" from "all".
  - **The newcomer picks shops after all.** Every shift segment carries its
    own `locationId` (`shift-segment.data.ts:16-30`). A newcomer filling in
    hours therefore chooses shops, which D3 reserves for the admin.
  - **Two locations is already modelled, but not stated.** Segments support
    it, with transfer time (`roster-week.system.ts:60-67, 209-210`).
  - **Per-location prices cannot be expressed.**
- **Rationale & Recommendation**:
  - Derive "works at" from the roster (`ScheduleVersion.locations`,
    `schedule-version.data.ts:228-241`) and write `locationIds` from it on
    save. Or require segments to be a subset of `locationIds`, enforced by a
    named system.
  - Make "every shop" an explicit choice, not an empty array.
  - State that there is one barber record per person across locations.
  - Hide the row for a one-shop business.
  - List per-location prices as a non-goal.

### M8. The newcomer's photo has no write path - Severity: Major

- **Reviewer Lens:** `egm-codebase-details`, `egm-implementation-readiness`, `egm-zoom-out` (Nit)
- **Affected Scope:** D3 (line 196); Staging step 2
- **Discrepancy Description**:
  - Barber faces live under `media/**`, which has no client writer
    (`storage.rules:67-69`).
  - The only owner-writable path is `avatars/{uid}`
    (`storage.rules:53-59`), and account erasure deletes it
    (`erase-client.pipeline.ts:108-109`).
  - A barber photo also needs width, height, blurhash and focal point
    (`barber.entity.ts:34-42`).
- **Rationale & Recommendation**:
  - The newcomer uploads to `avatars/{uid}`. A callable scoped to the
    caller's `linkedBarberId` copies the file into `media/` and writes the
    `avatarMedia*` fields. Say where the dimensions and blurhash are
    computed.
  - Never point the public photo at `avatars/{uid}`.
  - Or keep photos admin-only for now, and list this work in stage 2.

### M9. Who may call the editors is undecided, and today's roster gate is too wide - Severity: Major

- **Reviewer Lens:** `egm-design`, `egm-codebase-details`, `egm-implementation-readiness`, `egm-structural`, `egm-zoom-out`
- **Affected Scope:** Analysis (lines 62-69); D3; D4 (lines 218-230); D6; Staging step 2 (lines 326-327)
- **Discrepancy Description**:
  - **The brief says both.** Stage 2 calls the editors "admin callables",
    while tiers 2 and 3 have the newcomer editing.
  - **Any staff member can rewrite any roster today.** `setRosterWeek` and
    `amendRosterBreaks` gate only on `callerWorksTheBook`
    (`roster.wire.ts:63-68, 132-140`), and the pipeline checks nothing more
    (`set-roster-week.pipeline.ts:32`). `Roles.BOOK` includes `barber`
    (`roles.data.ts:56`). If the dates stay on the roster, that includes
    start and end dates.
  - **The planned fix is now possible.** `firestore.rules:58-74` says to
    narrow the gate once Barber ↔ User lands, and `StaffLink` has landed
    (`staff-link.data.ts:13-15`).
  - **Open questions.** The brief does not say whether "left to them"
    grants permission to write, or what a barber may edit a year later.
- **Rationale & Recommendation**: Define a fixed permission table, separate
  from the setup ledger. Enforce it in each editor's system, judged from
  stored roles inside the transaction.
  - The admin edits everything.
  - The account whose stored `linkedBarberId` is this barber edits name,
    photo, title, bio, Instagram and experience, and hours if the owner
    agrees.
  - Nobody else touches prices, shops, status, booking access, dates or
    roles.

  Apply the same self-or-manager gate to both roster callables and to
  `scheduleExceptions` writes before stage 4. Decide whether the front desk
  keeps hours editing. Refuse roster edits on DEPARTED records.

### M10. The invite's read paths contradict who needs them - Severity: Major

- **Reviewer Lens:** `egm-design`, `egm-codebase-details`, `egm-implementation-readiness`, `egm-comprehension`, `egm-structural`
- **Affected Scope:** D7 (lines 280-282, 296-304); D2 (lines 184-189)
- **Discrepancy Description**:
  - **The newcomer, not the admin, needs most reads.** "A callable or an
    admin-only rule" is left open. But the newcomer must:
    - see shop, inviter and role on `/join` before signing in;
    - query their own pending invite after signing in;
    - read the items left to them;
    - record skips.
  - **Decline has no identity check.** A forwarded link lets a third party
    decline.
  - **Admin rules mismatch.** `isAdmin()` includes the sysadmin
    (`firestore.rules:80-82`), while `Roles.ASSIGN` excludes it
    (`roles.data.ts:120`).
  - **The masked address cannot travel in an error.** The wire allowlist
    forbids person keys (`pipeline.error.ts:116-125`).
  - **The email check is fine.** It adds no new exposure: admins can
    already list users (`firestore.rules:210-211`).
- **Rationale & Recommendation**:
  - Set `staffInvites` to `allow read, write: if false`.
  - Name the callables:
    - `describeStaffInvite`: no sign-in, rate-limited, App Check on. It
      returns shop name, inviter's first name, role words, expiry state and
      the masked address (masked by a system).
    - `myStaffInvites`, keyed by the B5 email and `inviteeUserId`. Or
      return the pending invite id in the `verifyOtp` answer.
    - `acceptStaffInvite`.
    - `declineStaffInvite`, for a signed-in, matching identity only.
    - For the admin: `checkStaffInviteEmail`, `createStaffInvite`,
      `resendStaffInvite`, `revokeStaffInvite`, `listStaffInvites`.
  - Use `hasAnyRole(['admin'])`.
  - Generate invite ids from a CSPRNG, at least 120 bits (the current
    `nextId` source is unverified). Never derive them from the email.

### M11. A co-owner invite sent to a mistyped address hands over admin - Severity: Major

- **Reviewer Lens:** `egm-design`
- **Affected Scope:** D8 (lines 319-320); Alternatives (lines 148-150)
- **Discrepancy Description**: One OTP proves that someone owns the typed
  address, not that they are the intended person. A stranger who receives a
  co-owner invite can accept it, and the sheet's warning does not prevent
  that.
- **Rationale & Recommendation**: Pick one and state it in D8:
  - allow `admin` only on account-bound invites (`inviteeUserId`, sent from
    the client card);
  - give admin invites a short expiry, plus the inviting admin's
    confirmation after acceptance;
  - keep co-owner out of invites and grant admin later through `setRoles`.
    This is the smallest option.

### M12. Invite delivery has no port, no order, no failure handling and no trace - Severity: Major

- **Reviewer Lens:** `egm-design`, `egm-codebase-details`, `egm-structural`, `egm-implementation-readiness`
- **Affected Scope:** D7 (lines 286-295, 307-308); Analysis (lines 71-78); Staging steps 1 and 4
- **Discrepancy Description**:
  - **No port fits.** The only email port is `SendOtp`, the login-OTP
    identity (`identity.port.ts:58-73, 226-229`).
  - **The order is undefined.**
    - Sending first can leave a link to an invite that does not exist.
    - Committing first can leave a pending invite that was never mailed.
  - **Failed sends are unhandled.** The OTP path already had a refused send
    use up the resend window (`docs/production-deploy.md:266-270`).
    Stamping `lastSentAtUtcMs` at creation repeats that.
  - **No trace.** Logs may carry no contact value
    (`telemetry.port.ts:49-51`), and there is no metrics or tracing port.
    So "the invite never arrived" cannot be answered.
  - **Provider risks (unverified).** A free tier's daily cap could block
    OTP codes on a busy day. A hard bounce may suppress later OTP mail.
  - **Configuration.** The `/join` base URL has no configuration source
    (unverified). The invite callables must bind the provider secrets
    (`docs/production-deploy.md:293-297`).
- **Rationale & Recommendation**:
  - Add a `StaffInviteDeliveryPorts = { sendStaffInvite }` bundle (Law 9).
    One provider adapter may return
    `OtpDeliveryPorts & StaffInviteDeliveryPorts`.
  - Order:
    1. Commit the invite.
    2. Send.
    3. Write the delivery fields: `staffInviteDelivery` (`QUEUED | SENT |
PROVIDER_REFUSED | BOUNCED | SUPPRESSED`),
       `deliveryProviderMessageId`, `deliveryErrorCode`,
       `deliveryUpdatedAtUtcMs`.
  - Stamp `lastSentAtUtcMs` and `sendCount` only on confirmed sends, and
    measure the cooldown from those. Return a coded, retryable error to the
    admin.
  - Log `staff_invite.sent` and `staff_invite.send_failed`, with `inviteId`
    and `errorCode` only.
  - Show the delivery state on the member page.
  - Add a bounce webhook export.
  - Adapters: an `@emulatorOnly` console sender for the emulator, and a
    refusing adapter for deployed projects, so preflight P8 keeps refusing
    deploys.
  - Name the provider and its daily cap. Configure SPF, DKIM and DMARC once
    for both message streams.
  - Add «Копирай връзката». The link is not a bearer token, so the admin can
    hand it over in person at no cost.

### M13. Uniqueness, TTL, the T2 amendment, indexes and the send cap are not buildable as written - Severity: Major

- **Reviewer Lens:** `egm-implementation-readiness`, `egm-design`, `egm-structural`, `egm-zoom-out`, `egm-codebase-details`
- **Affected Scope:** D7 (lines 290-302); D8 (line 313)
- **Discrepancy Description**:
  - **Uniqueness needs a key document.** "Two pending invites refused"
    needs a document every sender reads; a random id plus a query does not
    make concurrent sends conflict. There is no per-barber check either.
  - **The TTL stamping misses invites.** `purgeAt` is stamped only on Set
    and Create (`firestore-tx.adapter.ts:63-66`), and
    `firestore-ttl.adapter.ts:96-131` has no `staffInvites` case. So:
    - a resend done as an Update keeps the old purge time;
    - an accept done as an Update keeps a `purgeAt` that later deletes the
      accepted invite.
  - **The T2 list is incomplete.** The 7-day expiry is itself a T2 rule
    (`docs/architecture/flatten-spec.md:532-555`). "Daily" must mean a
    rolling 24 hours, because an account has no location
    (`role-assignment.system.ts:157-159`).
  - **The per-admin cap cannot be counted from invites.** `sendCount` lives
    on each invite.
  - **The sign-in lookup is incomplete.** It must also match
    `inviteeUserId`, and `query-needs-limit` requires a limit.
    Equality-only queries may need no composite index (unverified).
- **Rationale & Recommendation**:
  - Create a key document `staffInviteKeys/{hash(lowercased email)}`, read
    and written in the create transaction. `HashPorts` is already in
    `SetRolesPorts` (`set-roles.pipeline.ts:84-88`), and `email.data.ts:31`
    already lowercases.
  - Also refuse, or revoke, a second pending invite for the same
    `barberId`.
  - Write every invite as a whole-body Set.
  - Add a `staffInvites` TTL group: a `RetentionAnchor` variant, a
    `RetentionSystem` formula, an `anchorOf` case, the `purgeAt` entry in
    `firestore.indexes.json`, and the runbook and `firestore-layout.md`
    lists.
  - Name both queries, each with `staffInviteStatus == PENDING` and
    `limit(2)`. Indexes:
    - (`inviteeUserId`, `staffInviteStatus`);
    - (`staffInviteStatus`, `createdAtUtcMs`) for the Team list;
    - `fieldOverrides` for the ledger arrays.
  - Add three T2 rows: invite expiry, resend cooldown, rolling send-cap
    window.
  - For the cap, use a per-invite `sendCount` cap plus the cooldown. Add a
    counter document only if needed, since only admins invite.

### M14. The invite costs a lot for what it adds; the smallest version is not considered - Severity: Major

- **Reviewer Lens:** `egm-zoom-out`
- **Affected Scope:** Goals (lines 103-107); D2 (lines 184-189); D7 (lines 278-308); D8 (lines 312-315); Staging steps 4-5
- **Discrepancy Description**:
  - **What the console step really is.** It is creating `barbers`,
    `barberSchedules` and offerings (`docs/production-deploy.md:742-748`).
  - **Linking already works.** It runs from the client card («Роли» →
    `setRoles` with a barber link, `client-card.store.ts:2150-2189`), and
    lookup by email exists (`UserLookupPorts.findUserByDestination`,
    `identity.port.ts:105-107`). So stage 2 alone removes the console step.
  - **The invite adds one thing:** granting roles before the first sign-in.
  - **What it costs:**
    - a new collection, its rules, and five states;
    - a cooldown, a cap, `sendCount`, an expiry, a TTL, a T2 amendment and
      an index;
    - a pre-sign-in page, the masked address, a client-card variant and a
      decline path;
    - the work in M10-M13 and B3-B5.
  - **Who the limits guard against.** They guard against the admin, who can
    already change everyone's roles.
- **Rationale & Recommendation**:
  - Treat invites as optional, and decide after stage 2 is in use.
  - **Smallest version:** stage 2 plus «Свържи акаунт».
    `findUserByDestination` plus `setRoles` with `BarberLinkChange.Set`; if
    the person has no account yet, the page says "ask them to sign in once".
  - **If invites stay:**
    - key them by an email hash;
    - use three states: `PENDING | ACCEPTED | REVOKED`;
    - make one fixed expiry the only new T2 rule;
    - the email links to normal sign-in, which then shows the pending
      invite;
    - handle double-submit with the existing `operationId`;
    - drop the cooldown, the cap, DECLINED, the pre-sign-in details, the
      masked address and `inviteeUserId`.
  - Comprehension's M19 proposals add states and copy back. Pick one level.

### M15. The apprentice variant: history, a duplicated end date, and the preset alternative - Severity: Major

- **Reviewer Lens:** `egm-zoom-out`, `egm-structural`, `egm-design`, `egm-comprehension`, `egm-codebase-details`, `egm-implementation-readiness`
- **Affected Scope:** D6 (lines 264-276); Goals (lines 111-112); Non-goals (lines 118-120)
- **Discrepancy Description**:
  - **Most apprentice fields repeat existing data or have no reader.**
    - The label is already `BarberMeta.title` (`barber.entity.ts:18`).
    - The end date repeats the roster end (B1).
    - Lower prices are ordinary offerings, and staff-only is the listing
      setting.
    - The supervisor's only reader is deferred, and the course link has no
      reader.
    - No apprentice concept exists in the code today.
  - **Graduation loses the history.** The transition rule deletes the
    APPRENTICE variant's fields, so "keeps their history" holds for visits
    but not for the apprenticeship period.
  - **A supervisor can dangle.** A departing supervisor leaves
    `apprenticeSupervisorBarberId` pointing at a DEPARTED record.
  - **Optional fields must be nullable.** `apprenticeCourseId` must be
    `CourseId | null`; `?:` is not allowed.
  - **Supervisor access already exists.** Every barber reads every
    appointment (`firestore.rules:54-56, 299-300`), so lines 275-276 are
    moot.
  - **The end date passes silently.** The apprentice stops being bookable
    with no warning. That is the failure the brief uses to reject
    dismissible setup (lines 225-228).
  - **Dropping out is not covered.**
- **Rationale & Recommendation**: Decide between two options.
  - **(a) A preset only.**
    - Title «Курсист» or «Стажант», STAFF_ONLY, a bounded window, prices
      copied and then edited.
    - Graduation means changing the title, extending the window and
      repricing, all with the same editors.
    - Drop `staffTrack`, the supervisor, the course link and the percentage
      until something reads them.
  - **(b) The variant**, with:
    - one end date (the B1 window), or the apprentice end as a review date
      only;
    - a `barberGraduatedLocalDate` stamp, or a statement that the history
      lives in audit rows;
    - the Depart pipeline listing the apprentices of a leaving supervisor;
    - a reminder before the end date: «Обучението на Петър свършва на 15
      март · Завърши / Удължи»;
    - dropping out handled as a departure.

  Correct lines 275-276 either way.

### M16. An apprentice with the `barber` role reads the whole book and every client profile - Severity: Major

- **Reviewer Lens:** `egm-structural`, `egm-implementation-readiness`
- **Affected Scope:** D6 (lines 275-276)
- **Discrepancy Description**: The `barber` role reads every appointment and
  opens any client profile (`firestore.rules:54-56, 209, 299`). A course
  student gets the same access until someone removes the role.
- **Rationale & Recommendation**: Decide in writing. Either:
  - accept it, and remove the role automatically at the end date through
    Depart; or
  - add a narrower role now. That touches the rules, the token claims and
    `role.rules-parity.spec.ts`, and it is cheaper before the first course
    than after.

### M17. "Every change is audited" will credit the Admin SDK, not the person - Severity: Major

- **Reviewer Lens:** `egm-codebase-details`, `egm-implementation-readiness`, `egm-design` (Nit)
- **Affected Scope:** D4 (lines 235-236); D1 (line 174)
- **Discrepancy Description**:
  - **Callable writes are recorded as the system.** They go through the
    Admin SDK, and the governed triggers record them as
    `SYSTEM`/`ADMIN_SDK` (`audit.system.ts:771-775`;
    `docs/production-deploy.md:716-720`).
  - **The only link back is missing on these collections.** That link is
    `writeOperationId`, stored only on `customers`
    (`governed-change.system.ts:238-257`).
    - `setRosterWeek` validates `operationId` and then drops it
      (`roster.wire.ts:183-186`; `set-roster-week.pipeline.ts:81-85`).
    - `Barber`, `BarberSchedule` and `Service` have no `WriteProvenance`
      slice.
- **Rationale & Recommendation**:
  - Each editor callable writes a human-credited audit row inside its
    commit, as `setRoles` does. Add a `GovernedChangeSystem` skip rule, like
    `auditedByCallable` (`audit.system.ts:850-857`), to avoid duplicate
    rows.
  - At minimum, add `WriteProvenance` to the three collections and pass
    `operationId` through the roster callables.
  - New audit actions:
    - `STAFF_INVITE_CREATED`, `SENT`, `RESENT`, `REVOKED`, `DECLINED`,
      `ACCEPTED`;
    - `BARBER_STATUS_CHANGED` and `BARBER_BOOKING_ACCESS_CHANGED`.

### M18. The Team list joins three sources and has no member-state vocabulary - Severity: Major

- **Reviewer Lens:** `egm-structural`, `egm-comprehension`, `egm-codebase-details`, `egm-implementation-readiness`
- **Affected Scope:** Overview (lines 33-36); Goals (lines 98-99, 102); D1 (lines 166-174); D2 (lines 178-187); D8 (lines 317-318); Staging step 2
- **Discrepancy Description**:
  - **Three sources.** Barbers are `barbers/{id}`, front desk and content
    people are only `users/{uid}.roles`, and pending people are only
    `staffInvites`.
  - **People can vanish.** A purged front-desk invite makes that person
    disappear from the list. Front desk or content without an email: Save
    creates nothing at all.
  - **Roles are business-wide, not per shop.**
  - **The row has no wording.** It mixes lifecycle, invite state, checklist
    and access with no defined words.
  - **DRAFT records reach neither Team nor the picker.** `observeBarbers`
    filters ACTIVE (`catalog.adapter.ts:46-53`), so DRAFT records never
    reach Team or the client-card barber picker.
  - **Unbookable reasons have one code.** The only server code is
    `BOOKING_BARBER_NOT_ROSTERED` (`booking.error.ts:40`).
- **Rationale & Recommendation**:
  - Declare Team a derived view.
    `TeamRosterSystem.membersOf(barbers, staffAccounts, pendingInvites)`
    returns one stage tag per member, for example `INVITE_SENT`,
    `INVITE_EXPIRED`, `SETTING_UP`, `READY_TO_GO_LIVE`, `STAFF_ONLY`,
    `ACTIVE`, `LAST_DAY_SET`, `DEPARTED`.
  - `BarberBookabilitySystem.reasonsOf` returns reason tags. A presenter
    words both (Law 10.2). The same tags go on the booking refusal (B2), so
    refused calls can be grouped by reason.
  - Add a `TeamReadPorts` bundle with its own token: an admin read across
    all statuses that does not widen `/book`.
  - Require an email for the non-barber presets.
  - Add a non-goal: non-barber staff have no lifecycle, leaving is a role
    removal, and the audit trail is their history. Roles are not per shop.
  - An admin-only `staffMembers/{id}` record is the heavier alternative.

### M19. The newcomer's step order is undefined, and several stuck states have no answer - Severity: Major

- **Reviewer Lens:** `egm-comprehension`, `egm-implementation-readiness`
- **Affected Scope:** D7 (lines 296-304); D4 (lines 215-217); D1 (lines 173-174); Alternatives (lines 144-150)
- **Discrepancy Description**:
  - **A new person must register first.** `admitTarget` requires
    REGISTERED (`role-assignment.system.ts:143-145`).
  - **The redirect chain is fragile.** It survives sign-in and registration
    only if `/join` passes `?redirect`
    (`libs/features/client/auth/src/lib/client-auth/client-auth.ts:259-269, 477-485`;
    `client-onboarding.ts:200-201`). Behind `activeGuard`, a first sign-in
    would lose it (`session-access.system.ts:79-80`).
  - **Uncovered cases:**
    - Already signed in as someone else: the shop tablet as front desk, or
      a client with a personal email.
    - Wrong email: "the admin must resend" goes to the same wrong address.
    - Expired, revoked mid-sign-in (the person keeps the client account
      they just created), purged, or already accepted.
    - Never got the email. The OTP code also comes by email, with a 5-minute
      TTL (`auth-strategy.data.ts:81`), so a spam filter catches both.
    - A mail app's in-app browser session (unverified).
- **Rationale & Recommendation**:
  - Write the numbered steps:
    1. `/join`, unguarded, calls `describeStaffInvite`.
    2. «Влез» goes to `/auth?redirect=/join/{id}`.
    3. A new person registers at `/onboarding` (phone, first and last name
       required, `auth-strategy.data.ts:76-80`) and returns to `/join`.
    4. «Приеми» accepts (B3) and returns a token (B4).
    5. The setup flow opens.
  - Give each state its copy:
    - signed in as someone else: «Влязъл си като м•••@… Поканата е за
      и•••@…», with «Излез и влез с друг имейл»;
    - wrong email: «Помоли {inviter} да покани имейла, с който влизаш»,
      plus an admin «Смени имейла» that revokes and re-creates the invite
      for the same record;
    - expired, revoked, invalid and already-accepted invites each get their
      own line;
    - the code screen adds «Провери и папка Спам»;
    - the done screen says how to open the app.

### M20. Nothing hands the newcomer off to go-live, and «Пусни» is ambiguous - Severity: Major

- **Reviewer Lens:** `egm-comprehension`
- **Affected Scope:** D4 (lines 218-229); D5 (lines 247-248); Overview (lines 33-36)
- **Discrepancy Description**:
  - When the newcomer finishes, the card disappears and they are still not
    bookable. The admin has to keep checking Team.
  - The owner prefers automatic actions to buttons.
  - «Пусни го» also reads as "let him go", on a page that also says
    «Напуснал».
- **Rationale & Recommendation**:
  - The final card reads «Готово. {Admin} ще те пусне за записвания.» and
    stays in a waiting state.
  - The admin gets an inbox notification, «Иван е готов», that carries the
    action. The inbox and badge already exist (`site-menu.component.ts:210-218`).
  - Notify the newcomer when they go live.
  - Consider going live automatically when the last needed item is done,
    since the start date and the access setting already control when and
    for whom. Keep the button for admins who want to check first.
  - Rename the action to «Пусни за записи» or «Активирай», with a one-line
    confirmation: «Иван ще може да бъде записван от 1 декември.»

### M21. The newcomer meets two "finish your profile" flows - Severity: Major

- **Reviewer Lens:** `egm-comprehension`
- **Affected Scope:** Title (line 1); D4 (lines 220-223)
- **Discrepancy Description**:
  - Client registration already has an optional personalization phase:
    services, birthday and avatar (`personalize-step.data.ts:18-25`;
    `client-onboarding.ts:384-405`). It also has a "finish your profile"
    menu row.
  - `/onboarding` already means client registration
    (`app.routes.ts:55-62`).
  - So an invitee sees both flows, is asked for a photo twice, and has two
    menu rows.
- **Rationale & Recommendation**:
  - Skip client personalization for invitees.
  - Show one menu row, «Профил на бръснаря», with the existing badge rule
    (absent at zero, `site-menu.component.ts:185-196`).
  - Offer to reuse the same photo.
  - Call it "staff setup" in code and «Настройка» on screen.

### M22. Email mismatch, a changed email, and the outcomes the email check misses - Severity: Major

- **Reviewer Lens:** `egm-zoom-out`, `egm-comprehension`, `egm-codebase-details`, `egm-implementation-readiness`
- **Affected Scope:** Analysis (lines 88-93); D2 (lines 184-189); D7 (lines 303-304); D8
- **Discrepancy Description**:
  - **The login email cannot be changed** (`user.entity.ts:80-83`; contact
    change was not shipped, D12(b)).
  - **A different address creates a second account.** If the admin types a
    work address while the barber's client account uses a personal one, the
    check answers "new person". Accepting then creates a second account and
    a second client record (`complete-registration.pipeline.ts:240-248`;
    client merge is off), and the old account keeps the history.
  - **A later email change does the same.**
  - **The check misses several cases:** blocked, erased, PROVISIONED but
    never registered (the lookup returns these, `identity.port.ts:103-104`),
    and a former member.
  - **Gaps in the wording.**
    - "Already on the team" is undefined.
    - No copy is given for any case.
    - "Offers to change their roles instead" does not say where. The client
      card's «Роли» block exists (`client-card.ts:218`).
- **Rationale & Recommendation**:
  - When the check answers "new person", the sheet asks the admin to search
    the clients first.
  - When the person is a known client, make the account-bound
    (client-card) path the default.
  - Define "already on the team" as `Roles.isStaff(stored roles)` or an
    existing barber link.
  - Add outcomes and copy for blocked, erased, signed-in-never-registered,
    and a former member («Върни в екипа», same record).
  - Open the existing «Роли» block rather than a copy.
  - Write down that a changed email means a new account. The admin moves
    the link with `setRoles`: clear it on the old account, set it on the
    new one.

### M23. Natural outcomes the brief does not answer - Severity: Major

- **Reviewer Lens:** `egm-design`, `egm-codebase-details`, `egm-zoom-out`, `egm-comprehension`, `egm-implementation-readiness`, `egm-structural`
- **Affected Scope:** Goals (lines 97-114); D5 (lines 238-262); D8 (lines 310-321)
- **Discrepancy Description**:
  - **Leave and guests.** Leave of absence and guest barbers are not
    mentioned.
  - **The owner who also cuts hair.** D8 refuses inviting yourself, and
    `setRoles` refuses changes to your own account
    (`role-assignment.system.ts:204-206`). Yet `roles.data.ts:5-6` notes
    that a shop owner is commonly both barber and admin. The most common
    barber in a small shop cannot link their own record.
  - **Rehire.**
    - The link is cleared, and the lock may block a new account
      (`role-assignment.system.ts:245-249`).
    - Stale future versions return.
    - The gap is erased (M2).
- **Rationale & Recommendation**: Write these recipes into D5 and D8, so
  that nobody adds new states for them later:
  - **Leave:** a series of CLOSED day exceptions
    (`exception-effect.data.ts:7-8`; at most 366 days under Law 5 and the
    2026-11-07 truth-is-a-pattern ruling), or a roster gap. The barber stays
    listed, and the card reads «В отпуск до …».
  - **Guest:** the Barber preset, no account, a bounded window.
  - **Owner who cuts hair:** «Добави и мен като бръснар». It links the
    caller's own account and adds only `barber`. The last-admin invariant is
    about removing admin, which this does not do.
  - **Rehire:** a new window plus a new invite or a `setRoles` call, with
    old hours and prices prefilled.
  - **Dropping out of a course:** a departure.

### M24. DRAFT records and their offerings are public, and departed barbers vanish from history - Severity: Major

- **Reviewer Lens:** `egm-design`, `egm-codebase-details`, `egm-comprehension`, `egm-implementation-readiness`, `egm-structural`
- **Affected Scope:** D5 (lines 241-243); D6 (lines 271-272); D3 (lines 204-206)
- **Discrepancy Description**:
  - **"Not listed" is only a UI fact.** `barbers/*` and `services/*` are
    `allow read: if true` (`firestore.rules:559-566`). Anyone can list DRAFT
    names and photos. That exposes a barber who is still working out notice
    at a competitor.
  - **Offerings leak drafts.** The offerings on each service show DRAFT
    barber ids and prices.
  - **Names go missing from history.** Client visit names come from the
    ACTIVE-only list (`client-appointments.ts:399-414`), so visits with a
    staff-only apprentice or a departed barber show no name.
- **Rationale & Recommendation**:
  - Use the rule
    `allow read: if resource.data.barberStatus != 'DRAFT' || isStaff()`,
    with a rules integration test. It works with the existing ACTIVE query
    and keeps DEPARTED readable for history.
  - Resolve history names with by-id reads.
  - Either accept that DRAFT offerings are visible, or stage them on a
    staff-only document and write them to `services` in the go-live
    transaction.

### M25. Staff invites keep personal data with no retention or erasure path - Severity: Major

- **Reviewer Lens:** `egm-design`, `egm-codebase-details`, `egm-implementation-readiness`
- **Affected Scope:** D7 (lines 283-292); D8 (line 321)
- **Discrepancy Description**:
  - **No retention for accepted invites.** The TTL covers only unaccepted
    invites, so accepted ones keep `inviteeEmail` and `inviterName` forever.
  - **Export and erasure miss the collection.** Neither footprint knows
    `staffInvites`. Erasure already marks `inviterName` on referral
    invitations (`client-erasure.system.ts:758-766`).
  - **"Unchanged from today's behaviour" is vague.**
    - Removing `barber` clears the link.
    - Erasure refuses staff accounts.
    - A held lock blocks re-linking until someone deletes it in the console
      (`role-assignment.system.ts:140-141, 246-249`).
- **Rationale & Recommendation**:
  - Give every invite a `purgeAt`, accepted ones too, since the audit row is
    the lasting record. Or set `inviteeEmail` to null on ACCEPTED.
  - Add `staffInvites` to export and erasure: match on `inviteeEmail`,
    `inviteeUserId` and `inviterUserId`, and mark the email and the name.
  - Replace line 321 with the actual behaviour and its console remedy, or
    add an admin release action.

### M26. The staging order is not buildable as listed - Severity: Major

- **Reviewer Lens:** `egm-implementation-readiness`, `egm-zoom-out`, `egm-design`, `egm-structural`
- **Affected Scope:** Staging (lines 323-333)
- **Discrepancy Description**:
  - **Stage 1 is not a build dependency.** The emulator already uses a
    console OTP sender (`identity.port.ts:59-65`). Stage 1 is a production
    launch blocker.
  - **Stage 2 comes before DRAFT exists.** Its offerings move public prices
    at once (`catalog-pricing.system.ts:82-109`), and its roster saves enter
    capacity (`main.ts:1059-1067`).
  - **Stage 3 hides booking-core work** that it does not name (B2).
  - **Stage 6 re-touches earlier work.** It adds a slice to `Barber`, which
    means revisiting stage 2's editors, stage 3's filters and every fixture.
  - **Leaving comes last.** The roster end and «Напуска» (B1, M1) sit at
    stage 7, after the stages that need them.
  - **No checks.** There are no exit tests, no cost, no timeline and no
    metrics.
- **Rationale & Recommendation**: Reorder the stages:
  - **0. The `Barber` schema, in one change.** Lifecycle (M2), window (B1),
    the "any barber" flag, the track if the variant stays, every reader from
    B2, the seed and the index. Verify by flipping seed statuses in the
    emulator.
  - **1. The editors.** Profile, offerings with copy-from, hours within the
    window, the Team list, «Пусни», «Свържи акаунт», «Напуска» with role
    removal, permissions (M9) and audit (M17).
  - **2. Invites, if still wanted.** An `@emulatorOnly` sender, and a
    refusing adapter for deployed projects.
  - **3. The newcomer's setup.**
  - **4. Apprentices.**

  Run the email sender as a parallel launch track. Give each stage one exit
  test. For stage 1: on a fresh emulator, an admin adds a barber, prices and
  hours and goes live with no console write; a client books them on
  `/book`; and a leaver loses book access the same day.

### M27. The brief's structure: order, duplicates, contradictions and missing sections - Severity: Major

- **Reviewer Lens:** `egm-structural`, `egm-design`, `egm-comprehension`
- **Affected Scope:** Whole brief; Analysis (lines 45-48); Key Decisions (lines 164-321); Staging
- **Discrepancy Description**:
  - **Order.** D2 uses D3, D5 and D7 before they are defined, and D4
    depends on D7.
  - **Decided in several places:**
    - start date: lines 178, 201, 255-257;
    - end date: lines 258, 267-270;
    - "any barber" defaults: lines 252-254, 269;
    - presets: lines 58-59, 269, 317-320, with no preset table.
  - **Contradictions:**
    - the non-goal at lines 129-130 vs. stage 7;
    - roles: line 202 vs. line 316;
    - the name: line 178 vs. line 195;
    - "computed from the barber record" (line 208) vs. data spread over
      four collections.
  - **Analysis mixes two things.** It is announced as the home of the
    findings but holds the author's objections.
  - **Missing sections:** data shapes, error codes, the rules, index and
    TTL list, ports and tokens, risks, open questions, cost, timeline and
    metrics. Lines 5-7 call every decision a recommendation, yet none is
    listed as open.
  - **Terms used before they are defined:**
    - roster, offering, the `linkedBarberId` lock
      (`barbers/{id}/restricted/link`), `RoleAssignmentSystem`, and
      `Roles.MONEY`/`ASSIGN`;
    - capacity (the `capacity/{YYYY-MM}` projection), and "any barber",
      which the UI calls «Който и да е»;
    - "staff home", "variant stamps" and "soft start";
    - front desk is `receptionist` and content editor is
      `content_manager`, which the brief never says;
    - "Team area" and "Team page" are used interchangeably.
  - **The Overview opens in collection paths.**
- **Rationale & Recommendation**:
  - Reorder the decisions D1 → D5 → D6 → D3 → D7 → D2 → D4 → D8.
  - Give each fact one home and refer to it from elsewhere.
  - Add a preset table: preset × roles × lifecycle × access × "any barber"
    × default owners.
  - Resolve the four contradictions.
  - Split "Review findings and resolutions" out of Analysis.
  - Add a glossary and the missing sections.
  - **Cost.** At this scale every action is tens of operations, well inside
    the free quota (pricing unverified). Design's estimate:

    | Action                           | Reads           | Writes and side effects                          |
    | -------------------------------- | --------------- | ------------------------------------------------ |
    | Add a barber (about 10 services) | ~14             | ~15 writes, ~12 audit runs, one capacity rebuild |
    | Accept                           | ~6              | ~5 writes                                        |
    | Each sign-in                     | +1 query        | none                                             |
    | Team page                        | ~130            | none                                             |
    | Each booking                     | +k barber reads | none                                             |

  - **Metrics:** time from «Add» to the first bookable slot, the share of
    invites accepted within 7 days, barbers still in DRAFT after 14 days,
    and refused bookings by reason.
  - Open with one plain-language paragraph stating the objective.

### M28. Proposed names and homes that need lawful shapes - Severity: Major

- **Reviewer Lens:** `egm-structural`, `egm-design`, `egm-implementation-readiness`, `egm-codebase-details`, `egm-comprehension`
- **Affected Scope:** Analysis (lines 82-86); D3; D5 (lines 247-258); D6 (line 266); D7 (lines 279-302)
- **Discrepancy Description**: Each proposed name, and the lawful shape:
  - `staffTrack` on the barber record → `barberTrack`, to match
    `barberStatus` and `barberPreference` (Law 6.2).
  - `bookingAccess` → `barberBookingAccess`, or fold it into `barberStatus`
    (M2). The value EVERYONE already includes staff; consider
    `ONLINE_AND_STAFF`.
  - The "any barber" setting has no field name or dictionary → for example
    `barberAnyPool: INCLUDED | EXCLUDED`.
  - `StaffInviteId` is never declared →
    `Brand<string, 'StaffInviteId'>` with `parse`, plus
    `Collections.StaffInvites`.
  - Setup items have no dictionary → `StaffSetupItem`. If an error lists
    items, the dictionary lives in `@core/primitives`, because errors import
    only primitives (Laws 7.5 and 8). The same goes for `staffInviteStatus`
    if an error carries it.
  - No error codes are listed → `libs/ecs-core/src/errors/staff-invite.error.ts`
    with:
    - `STAFF_INVITE_SELF`
    - `STAFF_INVITE_DUPLICATE_PENDING`
    - `STAFF_INVITE_EXPIRED`
    - `STAFF_INVITE_NOT_PENDING`
    - `STAFF_INVITE_EMAIL_MISMATCH`
    - `STAFF_INVITE_INVITER_NOT_ADMIN`
    - `STAFF_INVITE_RESEND_COOLDOWN`
    - `STAFF_INVITE_DAILY_CAP`

    Plus `BARBER_GO_LIVE_INCOMPLETE`, `BOOKING_BARBER_NOT_BOOKABLE` and
    `SCHEDULING_ROSTER_OUTSIDE_EMPLOYMENT`. Add their params to
    `WIRE_PARAM_ALLOWLIST` (`pipeline.error.ts:126-132`).

  - "Needed to go live" drives four surfaces → one
    `StaffSetupSystem.checklistOf`, which the presenters only word
    (Law 10.2). «от 1 декември» is a `ShopNow` comparison made by a system.
  - No port bundles are named → `StaffInviteReadPorts`,
    `StaffInviteDeliveryPorts` and `TeamReadPorts`, reusing
    `UserLookupPorts`, `CommitPorts`, `ClockPorts`, `HashPorts` and
    `AuthAdminPorts`. One bundle per token or adapter, no `Pick`/`Omit`.
  - Optional fields → `X | null`, never `?:`.
- **Rationale & Recommendation**: Put these into a data-shapes table in the
  brief, so the draft design starts from lawful names.

---

## Nit

### N1. "Prices stay with the admin" does not follow from `Roles.MONEY` - Severity: Nit

- **Reviewer Lens:** `egm-codebase-details`, `egm-zoom-out`
- **Affected Scope:** Non-goals (lines 124-125)
- **Discrepancy Description**: `Roles.MONEY` covers repricing a seat and
  authoring a discount, and it includes the receptionist and the sysadmin
  (`roles.data.ts:58-64`).
- **Rationale & Recommendation**: Add an admin-only grant such as
  `Roles.TERMS: [Role.Admin]`, or state whether reception may edit prices.

### N2. Bulgarian labels for presets and settings - Severity: Nit

- **Reviewer Lens:** `egm-comprehension`
- **Affected Scope:** Analysis (lines 58-59); D5 (lines 252-254); D6 (line 271); D8 (lines 319-320)
- **Discrepancy Description**: The presets are named in English, and
  «Ученик» on a public card reads as "schoolchild".
- **Rationale & Recommendation**:
  - Use the app's existing role words: «Бръснар», «Рецепция»,
    «Съдържание», «Администратор» (`bg.json:2287-2291`).
  - Rename "Co-owner" to «Администратор и бръснар», with the warning «Ще
    може да променя ролите на всички.»
  - Label the setting «Приема „Който и да е"».
  - Consider «Курсист» or «Стажант», with «Работи под надзор · по-ниска
    цена».

### N3. Declining by accident is final - Severity: Nit

- **Reviewer Lens:** `egm-comprehension`
- **Affected Scope:** D7 (line 285)
- **Discrepancy Description**: A person who declines by mistake has no way
  back.
- **Rationale & Recommendation**: Allow re-accepting until the invite
  expires, and tell the admin about both actions.

### N4. The arithmetic of copying prices is unstated - Severity: Nit

- **Reviewer Lens:** `egm-comprehension`, `egm-codebase-details`, `egm-design`, `egm-structural`, `egm-zoom-out`
- **Affected Scope:** D3 (lines 204-206); D6 (lines 269-270)
- **Discrepancy Description**: The brief states no rounding rule for a scaled
  `PriceCents`. Copy-from writes N `services` documents. Each fires an audit
  trigger and sits in every booking's read set.
- **Rationale & Recommendation**:
  - State the rounding rule (for example, to 0,50 €).
  - Scale variant overrides too.
  - Consider a duration multiplier, since apprentices are slower.
  - State that the copy is a one-time snapshot.
  - Write all N documents in one transaction.
  - Validate the input with `BarberOffering.parseAll` and `mixedCurrency`
    (`barber-offering.data.ts:119-166`).

### N5. Generated barber ids must not be `shop` - Severity: Nit

- **Reviewer Lens:** `egm-codebase-details`
- **Affected Scope:** D2 (line 181)
- **Discrepancy Description**: `AnalyticsGoalKey` reserves `shop`
  (`ids.primitive.ts:234, 250-251`).
- **Rationale & Recommendation**: Have the id generator, or the handle
  slug, refuse it.

### N6. Only DRAFT → ACTIVE is gated - Severity: Nit

- **Reviewer Lens:** `egm-structural`
- **Affected Scope:** D5 (lines 247-248)
- **Discrepancy Description**: The brief does not say what happens when the
  last offering is removed, or the hours end, after the barber is live.
- **Rationale & Recommendation**: State it. The reasons system (M18) can
  show it on the member page.

### N7. "Opens full screen on first landing" is stored state - Severity: Nit

- **Reviewer Lens:** `egm-structural`
- **Affected Scope:** D4 (line 220) vs D3 (line 208)
- **Discrepancy Description**: D3 says progress is never stored, but D4's
  first-landing behaviour needs a stored flag.
- **Rationale & Recommendation**: Say where the flag lives. On the device
  is fine.

### N8. The migration inventory and stale docs are not listed - Severity: Nit

- **Reviewer Lens:** `egm-implementation-readiness`, `egm-structural`, `egm-codebase-details`
- **Affected Scope:** Staging (lines 323-333)
- **Discrepancy Description**: What the change touches:
  - `INACTIVE` in `barber-status.data.ts:11` and in five specs;
  - the fixtures `catalog.fixtures.ts:307, 326, 345` (used by `seed:dev`
    and e2e), `booking-core.fixtures.ts:166`, `test-catalog.providers.ts:161`
    and `firestore.rules.integration.spec.ts:358`, plus the type-specs;
  - the index at `firestore.indexes.json:17-30`;
  - new exports, which change `main.spec.ts`'s literal table;
  - stale docs: `docs/production-deploy.md:742-780` and the TTL list in
    `firestore-layout.md`.
- **Rationale & Recommendation**:
  - Drop `INACTIVE`, or map it to DEPARTED.
  - Seed the three barbers as ACTIVE, EVERYONE, any, PROFESSIONAL.
  - Add DRAFT and staff-only barbers only in the specs that need them.
  - Deploy in the order indexes → rules → functions → hosting.

### N9. Analytics and the lead-time sampler count DRAFT rosters - Severity: Nit

- **Reviewer Lens:** `egm-implementation-readiness`, `egm-design`
- **Affected Scope:** D5 (lines 260-262)
- **Discrepancy Description**:
  - The sampler takes every barber with a roster
    (`sample-lead-time.pipeline.ts:73`).
  - Analytics lists every barber record (`analytics.port.ts:88-95`;
    `staff-analytics.spec.ts:680` expects 3 radars).
  - If utilisation divides by `rosteredMinutes` (`day-figures.system.ts:317`,
    unverified), DRAFT and STAFF_ONLY rosters lower it.
- **Rationale & Recommendation**: Let the bookability system decide what
  counts. Decide whether DRAFT barbers appear in the analytics scope menus.

### N10. Capacity contention during bulk setup - Severity: Nit

- **Reviewer Lens:** `egm-design`
- **Affected Scope:** Staging step 2
- **Discrepancy Description**: Every rebuild rewrites the shared
  `capacity/{YYYY-MM}` documents. Twenty roster writes on launch day contend
  on 3-4 month documents.
- **Rationale & Recommendation**: Triggers retry, but stagger bulk setup and
  say so in the runbook.

### N11. Two factual claims are only partly right - Severity: Nit

- **Reviewer Lens:** `egm-codebase-details`
- **Affected Scope:** Overview (lines 11-22); Analysis (lines 80-86)
- **Discrepancy Description**:
  - **"Three records written by hand."** `barberSchedules` already has a
    callable writer, which creates a roster for a barber with none
    (`set-roster-week.pipeline.ts:27-29, 81-85`). A barber also has a lock
    document and media (`firestore.rules:579-581`; `storage.rules:67-69`).
  - **"No reader or writer."** `invitations/{id}` has no creator and no web
    reader. But `redeemInvitation` writes it (`main.ts:1370-1379`), the
    rules allow get and list (`firestore.rules:770-771`), and erasure writes
    it.
- **Rationale & Recommendation**: Correct the wording. The referral
  collection's open `get` is a further reason not to reuse it.

---

## Claims checked by the synthesizer

| Claim                                                                               | Evidence                                                                 | Verdict   |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | --------- |
| Auth users are created without `emailVerified`                                      | `apps/functions/src/adapters/auth-claims.adapter.ts:89-95`               | Confirmed |
| Before registration, the form's email overwrites the stored one                     | `libs/ecs-core/src/systems/registration.system.ts:158-168`               | Confirmed |
| `amend` and `replaceFrom` always end open-ended; `replaceFrom` drops later versions | `libs/ecs-core/src/components/schedule-version.data.ts:134-140, 196-226` | Confirmed |
| Staff placement skips the roster window                                             | `libs/ecs-core/src/components/placement-policy.data.ts:34-39`            | Confirmed |
| `decide` refuses a non-`ASSIGN` caller and self-targeting                           | `libs/ecs-core/src/systems/role-assignment.system.ts:196-206`            | Confirmed |
| `setRoles` revokes refresh tokens                                                   | `libs/ecs-core/src/pipelines/set-roles.pipeline.ts:287-301`              | Confirmed |
| The booking read set does not read `barbers/{id}`                                   | `libs/ecs-core/src/pipelines/booking-read-set.pipeline.ts:164-168`       | Confirmed |
| No pipeline other than `setRoles` reads `Collections.Barbers`                       | grep over `libs/ecs-core/src/pipelines`                                  | Confirmed |
| `barbers/*` and `services/*` allow public reads; the link lock denies all           | `firestore.rules:559-581`                                                | Confirmed |

## Unverified items carried by reviewers

- Whether the web registration form sends the Email field under email OTP
  (B5).
- Whether ID tokens from custom-token sign-in carry `email` (B5).
- The granularity of `tokensValidAfterTime` when revoking and minting in the
  same second (B4).
- The exact moment the web signs out after a revocation (B4).
- How invite ids are generated today (`nextId`) (M10).
- Email provider pricing, daily caps and bounce suppression (M12).
- A configuration source for the `/join` base URL (M12).
- Whether equality-only queries need a composite index in this project
  (M13).
- Whether `/book`'s "anyone" choice draws only from the listed-barber stream
  (M2).
- Whether the analytics radars hide barbers with no visits, and the
  utilisation formula (N9).
- In-app mail browser session behaviour (M19).
- Firestore pricing figures behind the cost estimate (M27).
