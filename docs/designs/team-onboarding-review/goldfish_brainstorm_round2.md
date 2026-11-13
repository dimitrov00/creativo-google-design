# Goldfish Brainstorm Findings, Round 2: Team onboarding

**Target:** `concepts_brief.md` (lines 1-925), the revision after round 1
**Mode:** BRAINSTORM, round 2
**Date:** 2026-11-13
**Round-1 findings:** `goldfish_brainstorm_round1.md` (this folder). The brief is now `docs/designs/team-onboarding.md`; line numbers below refer to the revision as reviewed, not to the published file.

## Reviewer status

| Reviewer                       | Lens title                                | Status    |
| ------------------------------ | ----------------------------------------- | --------- |
| `egm-design`                   | Skeptical Architect Brainstormer          | completed |
| `egm-codebase-details`         | Codebase Grounding and Reuse Brainstormer | completed |
| `egm-zoom-out`                 | Contrarian / YAGNI Brainstormer           | completed |
| `egm-comprehension`            | UX & Ergonomics Brainstormer              | completed |
| `egm-implementation-readiness` | Migration & Rollout Brainstormer          | completed |
| `egm-structural`               | Maintainability & Tech Debt Brainstormer  | completed |

## Severity count

| Severity | Count |
| -------- | ----- |
| Blocker  | 1     |
| Major    | 30    |
| Nit      | 10    |

## How to read this

- Line numbers in "Affected brief section" refer to `concepts_brief.md`.
  Code paths are relative to the repository root.
- Each finding lists every lens that raised it. Where reviewers gave it
  different severities, the finding says so.
- No finding re-raises a round-1 finding that the revision resolved. Where
  a resolution is incomplete, the finding says which one, and the table
  near the end lists them.
- The synthesizer re-checked in the code the claims that the Blocker and
  the widely shared Majors rest on (list at the end). The other code
  citations come from the reviewers.

## Answers to the round-2 questions

1. **Did the round-1 resolutions close their findings?** B1, B3, B4, M2,
   M11, M16, N1, N3, N7, N10 and N11 are closed. Most others are partly
   closed. M1 (departure) is not closed: the leaver keeps a working staff
   session (B1 below). Three resolutions are wrong as written:
   - N5 reserves `shop` on the handle; the reservation is on the barber id.
   - M10/M13 key the invite by an unkeyed sha256 of the email, which goes
     against the repository's own rule for contact-derived ids (M2).
   - M13/M25 put the TTL on a number field that Firestore TTL never reads
     (M3).
2. **New problems from the revision.**
   - Email-hash invite id: privacy (M2) and re-invite semantics with a
     stale ledger pointer (M4).
   - `verifyOtp` hint: cheap and safe, but its failure mode and its effect
     on an explicit redirect are unstated (M20).
   - Self path: session behaviour unstated; possibly unneeded (M22).
   - Daily job: lawful as its own pipeline with a system actor, because it
     acts on a privacy boundary rather than storing a derived value. Unsafe
     as written (B1, M1).
   - Automatic go-live inside editor transactions: couples routine hours
     saves to onboarding (M11).
   - Ledger beside the link lock: a named match fits, and the parity spec is
     unaffected. Two comments and a rules `get()` need attention (N5).
   - Read rule: works for the public list. It breaks names on past visits
     after a rehire, and client queries by id (M7).
   - Permission table: the roster callables can be narrowed inside their
     transactions; day exceptions cannot under today's rules (M9).
3. **Internal consistency.** The Roles row contradicts "going live never
   waits on an account" (M10). The D2 table disagrees with rehire (M7).
   The delivery dictionary cannot hold the state the send order creates
   (M6). The TTL field is named two ways (M3). The rest are nits (N10).
4. **Stages 0 and 1.** Stage 0 is buildable, but its inventory misses
   about a dozen files and most of the stream's consumers (M29). Stage 1 is
   too large for one green boundary, and its leaving exit test cannot run
   in the emulator as written (M30).
5. **Open decisions.**
   - **O1, O3 and O4** are the right questions. O3 and O4 read as settled
     in D5's table; mark those rows as provisional.
   - **O2** should ask whether a per-member go-live setting is needed at
     all (M11).
   - **O5** asks the wrong question. The real decision is the
     `LocalizedText` type (M23).
   - **Add as open:**
     - the day-exception gate mechanism (M9);
     - whether hours can be delegated, which decides stage 4 (M18);
     - the status a rehire returns to (M7);
     - a go/no-go point for invites after stage 1 is in use (M30).
   - **Reopen:**
     - "never `email_verified`" (M5);
     - readiness checks inside editor transactions (M11).
   - **Settle rather than leave open:**
     - the close job revokes sessions;
     - it runs on the default location's zone;
     - it acts as the system (B1, M1).

## Where reviewers disagreed, and the recommendation

| Question                         | Positions                                                                                                                                                                                      | Recommendation                                                                                                                              |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity of the leaver's session | Design, codebase, implementation-readiness, structural: Blocker. Zoom-out: Major, Blocker if the wording stays. Comprehension: Major.                                                          | Blocker. Shipped as written, a leaver keeps reading every client's bookings and profile (B1).                                               |
| How go-live runs                 | Design, implementation-readiness: embed the check in each editor, exiting early when the record is not DRAFT. Zoom-out, structural: one idempotent pipeline called after each editor's commit. | The separate pipeline. Editors stay unaware of onboarding, and routine hours saves do not read ~30 service documents (M11).                 |
| The Roles row and go-live        | Design, comprehension, implementation-readiness: drop Roles from the go-live condition. Structural: the invite's granted roles satisfy it.                                                     | Drop it. Bookability depends on the barber record, not the account (M10).                                                                   |
| Where a rehire lands             | Design, comprehension, structural, zoom-out: skip DRAFT and return to the previous live status with a future start. Codebase: allow reads of any record that was ever live.                    | Skip DRAFT. `BARBER_BEFORE_START` already blocks bookings until the new start (M7).                                                         |
| When the close revokes sessions  | Codebase: before the commit. Others: after the commit, retried from a stored marker.                                                                                                           | After the commit, with a stored marker. A revoke before the commit leaves a short window in which a fresh sign-in mints the old roles (B1). |
| Former member in the email check | Design: store `barberFormerUserId` on the DEPARTED variant. Zoom-out, comprehension: start a rehire only from the Team page.                                                                   | The Team page. It needs no new field (M16).                                                                                                 |
| The self path                    | Design, comprehension: keep it, with its own decision and a token mint. Zoom-out: defer it; the owner is a no-email «Бръснар».                                                                 | Defer it, unless a reader of the link is planned for stage 1 (M22).                                                                         |
| The photo library                | Zoom-out: Major. Codebase: Nit.                                                                                                                                                                | Nit. It is a simplification, not a defect (N2).                                                                                             |
| The two-group setup screen       | Zoom-out: one dismissible card. Comprehension: one screen with hours on top. Structural: make it an open decision.                                                                             | Open decision on delegating hours first; the screen follows from it (M18).                                                                  |

---

## Blocker

### B1. Leaving does not end the leaver's access - Severity: Blocker

- **Lens:** `egm-design`, `egm-codebase-details`, `egm-implementation-readiness`, `egm-structural` (Blocker); `egm-zoom-out`, `egm-comprehension` (Major)
- **Affected brief section:** D10 «Напуска» steps 4-5 (lines 712-719); Goals (188-189); D11 port bundles (773-777); Stage 1 exit test (889-892)
- **Issue:**
  - **Access lives in the token.** Rules and callables judge the `roles`
    claim on the ID token, not `users.roles` (`firestore.rules:32-36`;
    `apps/functions/src/lib/booking/caller-roles.ts:5-14`). The claim is
    minted into the custom token at sign-in. Writing `users.roles` changes
    nothing for a live session. That is why `setRoles` revokes refresh
    tokens after its commit (`set-roles.pipeline.ts:72-81, 287-301`).
  - **The job never revokes.** D10 says the job removes roles "through the
    role-assignment rules". The revocation sits in the `setRoles` pipeline,
    not in `RoleAssignmentSystem`. The revoke port is handed to `setRoles`
    only, by design (`auth-claims.adapter.ts:22-24, 120-139`). D11 lists no
    `AuthSessionRevokePorts`.
  - **The job cannot use `decide`.** `decide` admits only a caller whose
    stored roles hold `Roles.ASSIGN` and who is not blocked
    (`role-assignment.system.ts:196-203`). A scheduled job has no caller.
    "The admin who set the date" is refused every day once that admin is
    demoted, blocked or erased.
  - **The remaining set can be empty.** `setRoles` replaces the role set,
    so a linked barber may hold only `barber`. Removing the staff roles
    leaves `[]`, which `decide` refuses (`:210-212`).
  - **A failed revoke is never retried.** The commit clears the link and
    the lock, and the next run skips a DEPARTED record, so nothing
    remembers which account still needs revoking.
  - **Result:** the leaver keeps `worksTheBook()` reads of every
    appointment and client profile for as long as their session refreshes.
    That is the hole round-1 M1 was meant to close.
- **Recommendation:**
  - Give the close its own pure decision in `EmploymentSystem`, never
    `decide`. The remaining set is the stored roles minus the staff roles,
    or `['client']` when nothing remains. Reuse the exported
    `RoleAssignmentSystem.linkOf` to release the link and the lock.
  - Revoke refresh tokens after the commit. Store a marker on the DEPARTED
    variant (for example the departed account id and
    `barberSessionsRevokedAtUtcMs: UtcEpochMs | null`). Every run retries
    until it succeeds, logging and alerting as `roles.sessions_not_revoked`
    does today.
  - Bind `AuthSessionRevokePorts` to the job and to the immediate close.
    Say that this deliberately widens the setRoles-only pin
    (`main.spec.ts:1686-1703`, per implementation-readiness).
  - State the residual: an issued ID token stays valid for up to an hour
    after revocation.
  - The exit test must show that an existing session loses access, not only
    that `users.roles` changed (see M30 for how to run it).

---

## Major

### M1. The close job's operating rules are unstated - Severity: Major

- **Lens:** `egm-design`, `egm-codebase-details`, `egm-zoom-out`, `egm-comprehension`, `egm-implementation-readiness`, `egm-structural`
- **Affected brief section:** D10 steps 4-5 (lines 712-719); D11 shapes (743-757); D12 logs (805-806)
- **Issue:**
  - **Attribution.**
    - "One audit row crediting the admin who set the date" records an act
      that admin did not take.
    - Nothing stores who set the date.
    - `SystemSource` has no value for a scheduled job
      (`actor.data.ts:27-45`).
  - **Admin holders.** Step 5 refuses an admin only when «Напуска» is
    pressed. «Роли» can grant `admin` afterwards, and the brief does not say
    what the job then does. Stripping it automatically would endanger the
    last-admin invariant (S-RU-11).
  - **Zone.** "Early in the shop's morning" is undefined with several
    locations, and barber dates carry no location. The precedent: schedules
    fire on `CRON_TIME_ZONE`, and each pipeline reads the default
    location's zone (`apps/functions/src/lib/cron-zone.ts:1-11`; four
    `onSchedule` exports at `main.ts:1095, 1101, 1212, 1274`).
  - **Catch-up and races.**
    - The job must select "last day before today", not "last day equals
      yesterday", or a missed run is never caught up.
    - It must re-read the last day inside the transaction, so an extension
      or a rehire made shortly before the run wins.
  - **The roster stays open.** Dropping later versions leaves the current
    version open-ended, so staff analytics keeps counting rostered minutes
    for the leaver (`staff-analytics.system.ts:651`, per
    implementation-readiness). `ScheduleVersion.closedAt` already exists
    (`schedule-version.data.ts:50-55`).
  - **Failures are invisible.** Only "periods closed" is logged. Nothing
    isolates one barber's failure from the others, as `sampleLeadTime`
    does (`sample-lead-time.pipeline.ts:86-104`). There is no failure event,
    no alert, and no Team-page state for a period that passed but was not
    closed.
  - **Lawfulness.** Built as its own sandwich (read barbers, decide purely,
    commit), the job is lawful under Laws 3 and 4. It acts on a privacy
    boundary and stores nothing derived (Law 5). A request-time check
    instead would need a new claim and a change to every `worksTheBook()`
    predicate, so the job is the simpler choice (zoom-out).
- **Recommendation:**
  - Credit `Actor` as the system under a new `SystemSource` (for example
    `SCHEDULED_JOB`), pointing at the `BARBER_PERIOD_CHANGED` row that set
    the date.
  - If the account holds `admin` at close time, leave its roles alone, set
    the rest, and show the case on the Team page («Администратор · махни
    ролята в „Роли“»).
  - Use the default location's `ShopNow`.
  - Re-decide inside one transaction per barber from the current record:
    roles, link, lock, roster `closedAt(lastDay)` with later versions
    dropped, DEPARTED, and the audit row.
  - Log `team.period_close_failed { barberId, errorCode }` and alert on it.
    Show «Достъпът не е спрян · Опитай пак» on the Team page.

### M2. The invite id is an unkeyed digest of the email - Severity: Major

- **Lens:** `egm-design`, `egm-codebase-details`, `egm-zoom-out`, `egm-comprehension`, `egm-implementation-readiness`, `egm-structural`
- **Affected brief section:** D7 "Where it lives" (lines 483-486), Uniqueness (506-509), logs (522-524), Personal data (580-582); D5 `setupInviteKey` (399); D11 (751, 776)
- **Issue:**
  - **The digest is plain.** `HashPorts.hash` is plain sha256
    (`crypto.adapter.ts:30-32, 71-74`).
  - **The repository's rule is a keyed digest.** For an id derived from a
    person's contact it uses `KeyedHash`, an HMAC under a server secret,
    because a plain digest of a contact can be reversed by guessing
    (`tx.port.ts:139-149`; `crypto.adapter.ts:76-86`, owner ruling OR-26).
  - **Where the digest would appear.** The id sits in:
    - the logs (`inviteId`);
    - the audit rows' resource paths;
    - the ledger, which the newcomer can read.

    "Logs never carry the address" then fails in substance
    (`telemetry.port.ts:47-53`).

  - **Erasure.** Erasure "clears the email" on a document whose id is
    derived from it.
- **Recommendation:**
  - Use a keyed bundle shaped like `WalkInKeyPorts`, under a dedicated
    secret (not `WALKIN_ID_KEY`, which is walk-in-only by design,
    `tx.port.ts:174-185`). Hash a versioned basis, `staffInvite/v1:` plus
    the parsed, lowercased email.
  - Bind the secret to `verifyOtp` and the invite callables, and update the
    secret-binding pins in `main.spec.ts`.
  - State that rotating the key orphans at most 7 days of pending invites.
  - Erasure deletes matching invite documents, as it already deletes OTP
    challenges (`client-erasure.system.ts:353-359`).

### M3. The TTL is placed on a field Firestore TTL never reads - Severity: Major

- **Lens:** `egm-design`, `egm-codebase-details`, `egm-implementation-readiness`, `egm-structural`; `egm-zoom-out` (Nit)
- **Affected brief section:** D7 body (line 490) and time rules (501-504); D11 "Indexes and TTL" (791)
- **Issue:**
  - **The repository's TTL field.** It is `purgeAt`, a Firestore
    `Timestamp` that the adapter stamps outside the entity type
    (`firestore-ttl.adapter.ts:7-21`; `firestore.indexes.json:1015-1056`;
    `.claude/rules/firestore-layout.md`).
  - **What the brief does.** It stores `purgeAtUtcMs` in the body, and D11
    puts the policy on that number. Firestore TTL deletes only on a
    Timestamp field, so invites would never be purged and M25 stays open.
  - **It contradicts itself.** D7 line 503 says `purgeAt`.
  - **The body field is a stored copy.** It duplicates what
    `RetentionSystem` computes.
  - **Stamping.** `anchorOf` has no `staffInvites` case, and the stamp is
    applied only on Set and Create (`firestore-tx.adapter.ts:63-66`).
- **Recommendation:**
  - Drop `purgeAtUtcMs` from the body.
  - Add a `staffInvites` retention group, anchored on `acceptedAtUtcMs`,
    else `revokedAtUtcMs`, else `expiresAtUtcMs` (the impersonation
    precedent), with an `anchorOf` case and a `purgeAt` TTL entry.
  - Write accept and revoke as whole-body Sets so they re-stamp.
  - Update the count of TTL policies in `docs/production-deploy.md`, the
    runbook §2.1, and the list in `firestore-layout.md`.

### M4. Re-invites are unspecified, and the ledger's invite pointer goes stale - Severity: Major

- **Lens:** `egm-design`, `egm-codebase-details`, `egm-zoom-out`, `egm-implementation-readiness`, `egm-structural`
- **Affected brief section:** D7 Uniqueness (lines 506-509), Accepting (546-566), Revoking (576-578); D5 ledger (399)
- **Issue:**
  - **One document per email, for good.** The brief does not say what a
    create does over an ACCEPTED, REVOKED or expired PENDING body that is
    still waiting for its purge.
    - If it refuses, a rehire cannot be re-invited for up to 30 days.
    - If it updates, the old purge stamp stays.
  - **The pointer is never cleared.** Accept, revoke, expiry and purge
    never clear `setupInviteKey`; the accept read list and the revoke
    transaction omit the ledger. So "refuses a second" refuses forever.
  - **An example.** An expired invite to address E for barber A is
    re-created for barber B. A's pointer now names B's invite, and A is
    refused with `STAFF_INVITE_BARBER_HAS_INVITE`.
  - **Two sources of truth.** The invite's `barberId` and the ledger
    pointer both record the same link.
- **Recommendation:**
  - A create is a whole-body Set when the document is absent, not PENDING,
    or PENDING and expired. Refuse only a PENDING, unexpired invite.
  - Either accept and revoke add the ledger to their transaction and clear
    the pointer, or the create dereferences the pointer and treats "missing,
    expired or not pending" as free.
  - Rename it `setupStaffInviteId: StaffInviteId | null`.
  - State that a re-create replaces the old body and that the audit rows
    keep the history.

### M5. The identity proof assumes a client cannot change its own Auth email - Severity: Major

- **Lens:** `egm-design`, `egm-codebase-details` (unverified; a Blocker if confirmed)
- **Affected brief section:** D7 "Who the newcomer is" (lines 531-537)
- **Issue:**
  - **The server side holds.** Only `provisionAuthUser` writes the Auth
    email (`auth-claims.adapter.ts:89-95`).
  - **The client side is unverified.** The Identity Toolkit
    `accounts:update` call (client `updateEmail`) may let a signed-in user
    set their own Auth email without proof when email-enumeration
    protection is off. This is unverified for this project and for
    custom-token users. If it works, `token.email` can be any address, and
    the accept check passes for a stranger.
  - **"Never `email_verified`" removes the natural defence.** An unproven
    change leaves that flag false.
- **Recommendation:**
  - `provisionAuthUser` sets `emailVerified: true` on the email channel;
    the code did prove the address.
  - Accept requires a matching `token.email` and `email_verified == true`.
    After stage 0's fix, it may also compare against `users.email`, which
    then has no client writer.
  - Preflight asserts that enumeration protection is on.
  - Add an Auth-emulator test: an account that changes its Auth email
    through REST is refused. Confirm in the same test that ID tokens from a
    custom-token sign-in carry `email`.

### M6. The delivery field cannot describe an invite that was not yet sent - Severity: Major

- **Lens:** `egm-structural`, `egm-implementation-readiness`; `egm-zoom-out` (Nit)
- **Affected brief section:** D7 body (lines 491-494), Sending (511-518); D8 `INVITE_NOT_SENT` (592)
- **Issue:**
  - **No value for the committed-but-unsent invite.** The invite is
    committed (step 1) before it is sent (step 2), but
    `staffInviteDelivery` is `SENT | FAILED`. The body written at the
    commit has no lawful value, and a crash between the two steps leaves a
    state the dictionary cannot hold.
  - **Variant fields at the root.** `deliveryErrorCode | null` and
    `deliveryUpdatedAtUtcMs | null` sit at the root instead of on the
    variants they belong to (Laws 1 and 6.2).
  - **Secrets.** The provider secrets each invite callable binds are not
    named.
- **Recommendation:**
  - Use `NOT_SENT | SENT | FAILED`, with `deliveryErrorCode` only on
    `FAILED` and a stamp on each variant.
  - Derive `INVITE_NOT_SENT` from that field.
  - Name the secrets each invite callable binds.
  - Zoom-out's lighter option is one field, since the callable already
    reports a failed send in its reply.

### M7. The read rule hides names on past visits after a rehire, and blocks client queries by id - Severity: Major

- **Lens:** `egm-design`, `egm-codebase-details`, `egm-comprehension`, `egm-structural`; `egm-implementation-readiness`, `egm-zoom-out` (Nit)
- **Affected brief section:** D2 table rows "Name on clients' past visits" and "readable by anyone" (lines 312, 316); D3 rules (347-350); D10 rehire (732)
- **Issue:**
  - **Rehire hides history names.** «Върни в екипа» sends a DEPARTED
    record back to DRAFT. Under `barberStatus != 'DRAFT' || isStaff()`, a
    client's read of it is then denied, so the barber's name vanishes from
    that client's past visits and the read errors. D2's "not applicable"
    for DRAFT is wrong for a rehire.
  - **Rules are not filters.** A client query by document id carries no
    status constraint, so the rules cannot prove `!= 'DRAFT'` and the whole
    query is likely denied even when no DRAFT is in it (unverified).
  - **The stamp is lost.** The variant-transition rule deletes
    `barberDepartedAtUtcMs` on DEPARTED → DRAFT.
  - **The lane rule contradicts the table.** D10's lane for a non-live
    barber with bookings contradicts D2's "no lane" for DRAFT.
  - **The ledger is not reset.** A rehire keeps old skips, the old
    go-live status and the old invite pointer.
- **Recommendation:**
  - A rehire skips DRAFT: set a new working period and return to the
    previous live status. `BARBER_BEFORE_START` already blocks bookings
    until the new start.
  - Codebase's alternative is to allow reads of a record that was ever
    live.
  - Read names by id as single gets.
  - The rules integration test covers a signed-out `== 'PUBLIC'` list, the
    staff `in` list, a client get of a DRAFT, and a client query by ids.
  - Define what the ledger keeps on rehire.

### M8. A DRAFT barber's photo is public through Storage - Severity: Major

- **Lens:** `egm-design`; `egm-codebase-details` (staging rule)
- **Affected brief section:** D5 Photo (lines 440-445); D3 (349-350)
- **Issue:**
  - **`media/**` is open.** It is `allow read: if true`
    (`storage.rules:67-70`), and under rules v2 that includes list.
  - **The path is guessable.** The seed path is `media/barbers/{id}.jpg`
    (`catalog.fixtures.ts:275`).
  - **DRAFT ids are public.** They appear in `services` offerings and in
    `barberSchedules` (`firestore.rules:559-562, 597-598`).
  - **So M24's case leaks.** A barber still working out notice elsewhere is
    exposed through their photo.
  - **The staging path has no stated writer rule.** It would need a
    `firestore.get`, as `accountMayUpload` does (`storage.rules:35-37`).
- **Recommendation:**
  - Keep the photo in the staff staging path until go-live, and copy it
    into `media/` in the go-live step.
  - Or use an unguessable object name and deny list on `media/barbers`.
  - State the staging path's writer rule.

### M9. The day-exception permission gate has no mechanism - Severity: Major

- **Lens:** `egm-design`, `egm-codebase-details`, `egm-zoom-out`, `egm-implementation-readiness`, `egm-structural`
- **Affected brief section:** D5 Permissions (lines 403-419); O3, O4 (839-841)
- **Issue:**
  - **The writes are client writes.** Day exceptions are written by
    clients under `mayEditRoster()` = `worksTheBook()`, with zero reads by
    design, because a multi-day block writes many days at once (S-DEP-5,
    `firestore.rules:610-631`).
  - **The rules cannot tell which barber the caller is.** No token claim
    says which chair the caller is; the rules note itself says
    self-or-manager "is not expressible yet" (`firestore.rules:58-74`).
  - **What the table would need.** "Own only" and "refused on DEPARTED"
    need `get()` calls, against S-DEP-5 and possibly over the access-call
    limit on a 366-day series (unverified), or a new claim.
  - **The citation is only partly right.** The `firestore.rules:58-74` note
    concerns exceptions. `barberSchedules` has no client writer
    (`:597-607`). The roster callables can be narrowed inside their own
    transactions.
  - **Missing columns.** The table has no column for the sysadmin or the
    content editor.
  - **A spec must change.** The rules spec asserting that any barber may
    write must change (`firestore.rules.integration.spec.ts:1421`, per
    implementation-readiness).
- **Recommendation:** make it an open decision with three options.
  - Move exception writes behind a callable that reads the stored link in
    its transaction, as the roster callables will. This is the
    synthesizer's lean.
  - Add a `linkedBarberId` claim, minted at sign-in and re-minted or
    revoked on every link change.
  - Accept one `get()` per write, after checking the limit.

  State the sysadmin's and the content editor's rights either way.

### M10. A pending invite makes going live wait on an account - Severity: Major

- **Lens:** `egm-design`, `egm-comprehension`, `egm-implementation-readiness`, `egm-structural`
- **Affected brief section:** D5 Items (lines 387, 390-392); D7 Accepting (546-566); Cost (822)
- **Issue:**
  - **The text contradicts itself.** "Roles: only when an account is
    linked or invited" (387) contradicts "going live never waits on an
    account" (391-392).
  - **The default barber is stranded.** If "done" means the account holds
    `barber`, every invited «Бръснар» (the default preset) stays DRAFT until
    they accept, and an ignored invite strands the barber.
  - **Expiry is never an event.** It is computed, so no transaction fires
    go-live when an invite lapses.
  - **Accept would need the check.** Accept would then have to run the
    readiness check, which its read list and its ~6-read cost omit.
- **Recommendation:**
  - Drop Roles from the go-live condition. Going live waits only on the
    bookability items: name, start day, shops, one offering, and hours
    inside the period.
  - Keep Roles on the checklist as an account row.
  - Structural's alternative is to let the invite's granted roles satisfy
    the row.

### M11. Automatic go-live couples every editor to onboarding and adds a per-member setting - Severity: Major

- **Lens:** `egm-design`, `egm-zoom-out`, `egm-implementation-readiness`, `egm-structural`, `egm-comprehension`; `egm-codebase-details` (Nit)
- **Affected brief section:** D8 add sheet (lines 609-610); D9 Going live (689-701); D5 `setupGoLiveMode` (398); Cost (826); O2 (837-838)
- **Issue:**
  - **Every completing writer must carry the check.** That means profile,
    period, shops, offerings (copy included), `setRosterWeek`,
    `amendRosterBreaks`, the link path, accept and revoke.
    - `setRosterWeek` reads 2 documents today and takes
      `CommitPorts & ClockPorts` (`set-roster-week.pipeline.ts:41, 56-61`).
    - Hours saves are routine for the front desk, so "a rare action" is
      wrong.
    - Each of these transactions would read every `services` document and
      conflict with offering writes.
  - **The cost figures are wrong.**
    - "None extra" for writes is wrong: going live writes the status, an
      audit row and notifications.
    - D9 says about 30 reads; the Cost table says ~33.
  - **The setting.** A per-member «Пусни сам · Чакай мен» is the kind of
    setting the owner asked to avoid.
  - **The copy reads backwards.** «Пусни сам» ("let him go live
    yourself") reads as the manual option, and D9 itself retires «Пусни»
    because it reads as "let go" (line 696).
- **Recommendation:**
  - One idempotent pipeline (for example `activateIfReady`) runs
    `StaffSetupSystem.checklistOf` in its own transaction.
    - The web calls it after each editor's commit, and «Активирай за
      записи» calls it too.
    - A failed call leaves DRAFT, which is the safe state.
    - The editors stay unchanged.
  - Consider one mode (automatic) and drop `setupGoLiveMode`, the `READY`
    tag and the «Иван е готов» notification. Reword O2.
  - If the setting stays, word it «Активиране: Автоматично · Ръчно».
  - **The other position (design, implementation-readiness):** embed the
    check, but read the barber record first and stop when it is not DRAFT.

### M12. The bookability check on staff edits traps leftover bookings - Severity: Major

- **Lens:** `egm-design`, `egm-codebase-details`, `egm-comprehension`
- **Affected brief section:** D3 (lines 323-342); D10 (707-709, 721-722); D5 `checklistOf` (390)
- **Issue:**
  - **Every stored seat's barber is checked.** `editAppointment` reads
    every stored seat's barber into the read set
    (`edit-appointment.pipeline.ts:613`). Edits include `REPRICE`,
    `REDURATE`, `DISCOUNTS`, `VOUCHERS` and `REMOVE_SEAT`
    (`edit-command.data.ts:22-33`).
  - **Normal corrections are refused.** Checking unchanged seats would
    refuse:
    - corrections to a leaver's last-day visits on the morning after;
    - edits to seeded history dated before "a working period from the seed
      date" (875-876).
  - **The lane does not help.** The leftover-bookings lane lets staff see
    those bookings, but perhaps not change them. What their clients are
    told is unstated.
  - **The inputs are wrong.** `verdictOf(…, serviceId, …)` cannot decide
    `BARBER_DOES_NOT_OFFER` without the service's offerings (Law 3, inputs
    in). `checklistOf(…, offerings, …)` should take the services as they
    are (zero inbound mapping).
- **Recommendation:**
  - Apply the verdict only to a seat being placed (book, add, move,
    restaff, relocate) and to the barber it is placed on. Cancelling, and
    moving a seat away from a non-bookable barber, stay open.
  - Pass the `Service` to `verdictOf`.
  - Add «Напуска» confirmation copy: «След {{date}} {{name}} има {{count}}
    записа. Остават в графика, докато ги преместиш или откажеш.»

### M13. The Team page has no buildable read path - Severity: Major

- **Lens:** `egm-codebase-details`, `egm-implementation-readiness`, `egm-structural`
- **Affected brief section:** D8 Team page (lines 586-603); D11 ports (773-777), indexes (784-791); Cost (824); Stage 3 (899-902)
- **Issue:**
  - **Accounts cannot be queried by role.**
    `membersOf(…, staffAccounts, …)` needs users by role, but `users.roles`
    has its single-field indexes switched off
    (`firestore.indexes.json:1005-1009`). The query passes in the emulator
    and fails in production.
  - **The other sources are deny-all.** `staffInvites` and `restricted/link`
    are deny-all, so `TeamReadPorts` cannot be a web Firestore adapter.
  - **No list callable.** None is named; round 1 named `listStaffInvites`.
  - **The bundle breaks Law 9.** One bundle spanning a Firestore adapter
    and a callable breaks Law 9's one-bundle-per-adapter rule.
  - **Notifications need the same query.** The admin recipients of the
    notifications need it too (M15).
- **Recommendation:**
  - State that `TeamReadPorts` is a callable, or split it into a barber
    read bundle and a `StaffInviteListPorts` bundle.
  - Choose the staff-account source:
    - re-enable `array-contains` on `users.roles`, with its index and a
      limit or `// unbounded-ok`; or
    - derive the list from the barber records, the link locks and the
      invites.
  - Add `listStaffInvites` to stage 3.

### M14. The Team page's stage tags overlap and miss members - Severity: Major

- **Lens:** `egm-comprehension`, `egm-structural`; `egm-zoom-out` (Nit)
- **Affected brief section:** D8 stage table (lines 586-600)
- **Issue:**
  - **Four axes, no precedence.** Ten tags mix lifecycle, invite state,
    setup progress and last day, with no rule for which wins.
  - **`LAST_DAY_SET` hides two presets' status.** «Курсист» and «Гост
    бръснар» always have a last day, so the tag hides their status from the
    first day.
  - **Unordered pairs.** DRAFT with `INVITE_SENT`, and `PUBLIC` with
    `INVITE_EXPIRED`, have no order.
  - **Not one tag per member.** `NO_ACCOUNT` is a modifier, which
    contradicts "one stage tag per member".
  - **Members with no tag.** No tag fits front desk, content editors, or
    admins with no barber record.
  - **«2 от 4» is undefined.** Name, start day and shops are always done at
    «Добави», so it is unclear what is counted.
- **Recommendation:** `TeamRosterSystem` returns three things, and the
  presenter only words them (Law 10.2):
  - one lifecycle tag: the four statuses, plus a role-only tag worded with
    the role words (`bg.json:2288-2291`);
  - one secondary note, picked by a fixed order: send failed, expired,
    pending, last day, no account;
  - done and needed counts over needed items only.

### M15. Notifications and reminders have no machinery, and one condition cannot be computed - Severity: Major

- **Lens:** `egm-codebase-details`, `egm-zoom-out`, `egm-comprehension`, `egm-implementation-readiness`
- **Affected brief section:** D6 reminder (lines 463-467); D9 notifications (692-695); D11; Stage 1 (888), Stage 5 (916-920)
- **Issue:**
  - **The inbox is not ready for this.**
    - `NotificationTopic` is a closed set, and only `WAITLIST_MATCH` has a
      production writer (`notification-payload.data.ts:18-46`).
    - Notifications are created only inside the matcher's plan
      (`notifications.port.ts:13-20`, per zoom-out).
    - The inbox is per account, so "the admin" means choosing recipients,
      which needs the query in M13.
  - **D11 lists none of it.** It names no topics, payloads, writers,
    recipients or de-duplication.
  - **One condition cannot be computed.** "A member who has not been told
    to leave" cannot be computed, because «Напуска» and the presets both
    write `barberLastWorkingLocalDate`.
  - **The copy fails several cases.**
    - «Обучението на…» is wrong for a guest.
    - «Остави» ends in DEPARTED without saying so.
    - A one-week guest gets the 7-day reminder on the day they are added.
  - **Built and tested in different stages.** Reminders are built in
    stage 1 and tested in stage 5.
- **Recommendation:**
  - **Preferred (zoom-out):** derive the reminder cards on the admin's
    staff home and Team page from `barberLastWorkingLocalDate` and
    `ShopNow`, lazily (Law 3). That needs no cron, no topics and no
    recipients.
  - **Otherwise:** add topics, payloads, a writer with deterministic ids
    and a stored recipient (for example the admin who added the member) to
    D11 and the stage inventory.
  - **The copy:**
    - remind about every last day with one neutral string: «Последният ден
      на {{name}} е {{date}} · Удължи»;
    - drop «Остави»;
    - add a system rule: no reminder when the period is 7 days or shorter.

### M16. Several answers of the email check cannot be built or lead nowhere - Severity: Major

- **Lens:** `egm-design`, `egm-zoom-out`, `egm-comprehension`; `egm-codebase-details` (Nit)
- **Affected brief section:** D8 "What the email check answers" (lines 612-623)
- **Issue:**
  - **"Former member" cannot be computed.** Leaving clears the link and the
    lock (`role-assignment.system.ts:292-293, 301-315`), and `Barber`
    carries no user id or email (`firestore.rules:63-65`). A guest never
    had an email.
  - **«Свържи сега» fails for a stub account.** "Has an account →
    «Свържи сега»" fails for an account that signed in but never
    registered: `admitTarget` requires REGISTERED (`:143-145`). Round-1 M22
    asked for this case.
  - **"Already on the team" dead-ends for a staff member with no record.**
    The «Роли» picker lists only catalogue barbers, and adding `barber`
    without a link is refused (`:294-297`).
  - **The admin's own email.** «Роли» is never offered for oneself.
  - **"Erased account" cannot be reached.** Erasure pseudonymises
    `users.email` (per codebase).
- **Recommendation:**
  - Start a rehire only from the DEPARTED rows on the Team page, and drop
    that answer. Design's alternative is a `barberFormerUserId` on the
    DEPARTED variant.
  - Add «Влизал е, но не е завършил регистрацията», which offers an invite.
  - A staff account with no link gets «Свържи сега» onto the new record.
  - The admin's own email goes to the self path, or to a no-email barber
    (M22).
  - Collapse to five answers:
    - new address, with a pending invite folding in as a resend;
    - registered account;
    - never registered;
    - already linked;
    - blocked.

### M17. The non-barber presets and the guest preset do not fit the flows - Severity: Major

- **Lens:** `egm-comprehension`; `egm-codebase-details`, `egm-structural` (Nit)
- **Affected brief section:** D4 preset table (lines 357-363); D8 Save (625-626); D9 step 6 (652-653, 661-662); Stage 3 exit test (905)
- **Issue:**
  - **Save creates a barber record for every preset.** That includes
    «Рецепция» and «Съдържание», which have no barber record.
  - **Their fields have no destination.** The name and start day go
    nowhere; the invite body has no invitee name.
  - **No path in stage 1.** Without invites, these two presets have no path
    there.
  - **Landing after accept is undefined.** `content_manager` can open
    `/staff/schedule` (`roles.data.ts:41-47`; `app.routes.ts:137`), but the
    rules deny it every appointment read (`firestore.rules:54-56`). Its
    area is `/admin/programs`.
  - **The guest can never be linked.** «Гост бръснар» lists "Roles if
    invited: none", but a link requires the `barber` role
    (`role-assignment.system.ts:274-279`). Yet the add sheet accepts an
    email.
  - **No copy for an already-live barber.** A barber who is already live
    when they accept has none.
- **Recommendation:**
  - Save per preset:
    - barber presets create the record;
    - non-barber presets create only the invite (stage 3), or are a
      «Роли» change on an existing account (stage 1).
  - Landing per role:
    - front desk → `/staff/schedule`;
    - content editor → `/admin/programs`;
    - a barber with items left → the setup screen;
    - otherwise → the schedule.
  - Decide the guest: no account (hide the email field), or the `barber`
    role.
  - Already-live copy: «Клиентите вече могат да те записват от 1 декември.
    Добави снимка и няколко думи за себе си.»

### M18. The newcomer's "needed" group is empty by default - Severity: Major

- **Lens:** `egm-zoom-out`, `egm-comprehension`; `egm-structural` (as an open decision)
- **Affected brief section:** D4 owner table (lines 365-371); D9 groups (664-687); Stage 4 (909-914)
- **Issue:**
  - **The group is empty by default.** D4 makes hours admin-owned for
    every preset, and the name is typed at «Добави». So «Нужно, за да те
    записват» is empty by default.
  - **Most of the screen serves an override.** «По-късно», the home card,
    the menu badge and the stage 4 exit test serve only the case where the
    admin overrides the default. Round-1 M4 asked for a decision on
    delegating hours; the brief kept both branches.
  - **The rationale does not hold.** The "between clients on the first
    day" argument fails, because a DRAFT barber has no lane (D2, line 309).
  - **"Staff home" is undefined.**
  - **Stage 4 is not useful on its own.** "Leave to them" needs an email
    (line 608).
- **Recommendation:**
  - Make "can hours be delegated?" an open decision.
  - If not, the newcomer's setup is one dismissible card listing the empty
    optional fields, with the dismissal stored on the device. The ledger
    then shrinks (zoom-out: carry the go-live target on the DRAFT variant
    and drop the ledger).
  - If yes, use one screen with hours as a single needed row at the top,
    and test the default path too.
  - Define "staff home" in the Words table.

### M19. `/join` cannot tell "another email" from "no invite", and misses two states - Severity: Major

- **Lens:** `egm-comprehension`
- **Affected brief section:** D9 "States `/join` must word" (lines 655-662); D7 (526-529, 539-544)
- **Issue:**
  - **The first state cannot be built.** The link carries nothing, and
    `myStaffInvite` looks up only the signed-in email, so the page cannot
    know that an invite exists for another address.
  - **Missing: an unregistered account.** A signed-in account that has not
    registered yet is refused at accept, because `admitTarget` requires
    REGISTERED.
  - **Missing: the shop tablet.** A tablet signed in as front desk, where
    «Излез» signs the shop out.
- **Recommendation:**
  - Merge the two states into one: «Няма покана за {{email}}. Ако поканата
    дойде на друг имейл, отвори връзката на своя телефон или излез и влез с
    него.»
  - Add «Довърши регистрацията, за да приемеш поканата.» · «Продължи»,
    going to `/onboarding?redirect=/join`.
  - Add a shared-device line before «Излез».

### M20. How sign-in recognises an invitee is undefined - Severity: Major

- **Lens:** `egm-comprehension`; `egm-design`, `egm-zoom-out` (Nit)
- **Affected brief section:** D9 Steps (lines 642-653); D7 "Finding a pending invite" (539-544)
- **Issue:**
  - **The skip has no mechanism.** The brief does not say how
    registration knows to skip client personalisation. Today Registered
    leads to the reward step (`onboarding-flow.system.ts:102-121`).
  - **The hint may hijack a booking.** Nothing says whether the `verifyOtp`
    hint overrides an explicit redirect. A client signing in from the
    `/book` review would be pulled out of their booking
    (`client-auth.ts:477-485`).
  - **Invitees read client copy.** That includes «…или опитай с друг имейл»
    (`bg.json:245`), and a different email can never match the invite.
  - **The hint's failure mode is unstated.** `verifyOtp` knows the proven
    email after its first transaction (`verify-otp.pipeline.ts:219-227`),
    so the read is cheap. But it couples sign-in to a rare event and
    changes the wire answer. Zoom-out suggests cutting it until the 7-day
    acceptance measure shows invites being missed.
- **Recommendation:**
  - `OnboardingFlowSystem` decides the skip from an invitee input:
    `redirect=/join`, or the hint.
  - The hint never overrides an explicit redirect. The menu then shows
    «Имаш покана за екипа».
  - A failed hint read never fails sign-in: run it after the session row,
    answer "no hint", and log it. Skip the hint under phone sign-in.
  - Give invitees their own copy on the identify, code and phone screens,
    for example «Влез с имейла, на който получи поканата.» («Провери и
    папка Спам» already exists at `bg.json:245`.)

### M21. The invitee still meets two "finish your profile" rows - Severity: Major

- **Lens:** `egm-comprehension`
- **Affected brief section:** D9 (lines 680-687); D5 Photo (444-445); "Where each finding went", M21 (line 153)
- **Issue:**
  - **The client row stays.** «Завърши профила си», with its progress bar,
    stays (`site-menu.component.html:120-168`; `bg.json:623`). It still
    counts the birthday and the profile photo (`bg.json:530-534`), so an
    invitee who uploads a barber photo is asked for a photo again.
  - **The new row sits beside a near-twin.** The new «Настройка» row sits
    next to the schedule's «Настройки» (`bg.json:1229`).
- **Recommendation:** use one row. For a linked barber, «Завърши профила си»
  shows the staff checklist, and the barber photo counts as the profile
  photo.

### M22. The self path and «Свържи сега» have unstated session effects - Severity: Major

- **Lens:** `egm-zoom-out`, `egm-comprehension`; `egm-design` (Nit)
- **Affected brief section:** D8 «Добави и мен като бръснар» (lines 634-638), «Свържи сега» (619); D10 recipe (730); Goals (182-183); Stage 1 (886)
- **Issue:**
  - **Either way the admin loses something.**
    - Reusing the role pipeline revokes the admin's refresh tokens
      (`set-roles.pipeline.ts:287`) and signs them out mid-setup.
    - Not revoking leaves the new link and `barber` claim missing until the
      next sign-in.
  - **It needs its own decision.** The last-admin proof covers only `decide`
    (`role-assignment.system.ts:161-167`).
  - **Sysadmin unstated.** Whether a sysadmin may use it is unstated.
  - **«Свържи сега» signs the barber out.** It runs `setRoles`, which signs
    the linked barber out on their phone, with no warning.
  - **The link may not be needed (zoom-out).** Today the link drives only
    the barber scope of «Анализи» (`session-identity.service.ts:79-91`).
    An admin already edits everything, so an owner who cuts hair can be a
    no-email «Бръснар», bookable with no new code.
- **Recommendation:**
  - Defer the self path, and treat the owner who cuts hair as a no-email
    «Бръснар».
  - If it stays: give it its own decision, mint a fresh token as accept
    does, do not revoke, and state the sysadmin rule.
  - Warn in the «Свържи» confirmation: «{{name}} ще трябва да влезе
    отново.»

### M23. The "Bulgarian required, English optional" rule contradicts the type - Severity: Major

- **Lens:** `egm-codebase-details`, `egm-structural`
- **Affected brief section:** D5 Language (lines 426-429); D11 (748); Stage 0 (866-867); O5 (842)
- **Issue:**
  - **The type requires both.** `LocalizedText` requires non-blank `bg`
    and `en` (`localized-text.data.ts:4-34`). It is shared by the barber's
    name, title and bio, by locations, services and programs.
  - **The name is not covered.** `name` stays `LocalizedText`, so "never
    has to write in two languages" is false for the name.
  - **Stage 0 is undefined.** "Settled in the draft" leaves stage 0's "one
    change" undefined.
  - **The fallback is a decision.** Choosing which text a screen shows is
    not wording (Law 10.2).
- **Recommendation:**
  - Decide now: write `en = bg` at save (no type change), or add a
    barber-only type with optional English.
  - List `name` in D11.
  - Put the fallback in `LocalizedText`'s pick helper.
  - Reword O5 as this type question.

### M24. "Every shop" has no stored shape, and the roster cannot enforce shops - Severity: Major

- **Lens:** `egm-codebase-details`, `egm-structural`
- **Affected brief section:** D5 Shops (lines 435-439); D11 shapes
- **Issue:**
  - **The empty list has a meaning today.** An empty `locationIds` means
    every shop, shared with `Service` through `LocationScopeSystem`
    (`barber.entity.ts:9`; `location-scope.system.ts:3-10`). The brief bans
    the empty list but names no replacement.
  - **The roster has no hook.** `RosterWeekSystem.setFrom` takes no
    allowed-shop set (`roster-week.system.ts:248-271`), and `setRosterWeek`
    never reads `barbers/{id}` (`set-roster-week.pipeline.ts:57-63`).
  - **Gaps.** There is no error code, and no rule for existing segments
    when a shop is removed.
- **Recommendation:**
  - Name the stored shape (for example a scope tag beside `locationIds`)
    and whether services keep the empty-list rule.
  - Add the roster parameter and `SCHEDULING_ROSTER_OUTSIDE_SHOPS`.
  - Define shop removal: refuse while segments exist, or drop them.

### M25. «Напуска» cannot list bookings from `barberBusy` - Severity: Major

- **Lens:** `egm-codebase-details`
- **Affected brief section:** D10 step 2 (lines 707-709)
- **Issue:**
  - **The days are queryable.** `barberBusy` can be queried by barber and
    date (`firestore.indexes.json:152-164`).
  - **The bookings are not there.** A busy day holds only `MinuteBlock`
    values (a range and a `blockKind`), with no appointment ids and no
    clients (`barber-busy-day.entity.ts:28`; `minute-block.data.ts:32`).
- **Recommendation:** use `barberBusy` to find the days. Then query
  `appointments` by `busyKeys array-contains` and `bookingStatus` on the
  existing index (`firestore.indexes.json:63-75`, per codebase).

### M26. The error list, two dictionary tiers and the accept refusals are incomplete or wrong - Severity: Major

- **Lens:** `egm-structural`; `egm-codebase-details`, `egm-implementation-readiness` (Nit)
- **Affected brief section:** D11 Errors (lines 763-771), shapes (749); D7 accept refusals (549-557); D5 field rules
- **Issue:**
  - **No code for these refusals:**
    - the barber missing or DEPARTED at accept;
    - invites switched off under phone sign-in;
    - the invitee not registered;
    - roster hours outside the working period or the chosen shops;
    - roster edits on DEPARTED;
    - photo rejections;
    - a rehire of a record that is not DEPARTED;
    - the self path when the caller is already linked.
  - **`admitTarget` is misdescribed.** D7 says accept refuses a blocked
    account through `admitTarget`, "reused". `admitTarget` checks missing,
    erased, unregistered and sysadmin, not blocked, and it is not exported
    (`role-assignment.system.ts:133-150`).
  - **An already-linked invitee is undecided.** `linkOf` would silently
    move the link (`:301-315`).
  - **Two dictionaries belong in primitives.** Errors import only
    primitives (Laws 7.5 and 8). So the bookability reason dictionary, which
    `BOOKING_BARBER_NOT_BOOKABLE` carries, and `StaffSetupItem`, which
    `TEAM_GO_LIVE_INCOMPLETE` carries, must live in `@core/primitives`
    without condition. D11 line 749 says "if".
  - **Missing from D11:** the `setupGoLiveMode` and team-stage
    dictionaries.
- **Recommendation:**
  - Add the codes and their wire-allowlist parameters.
  - Export `admitTarget` and add an explicit block check.
  - Refuse an invitee already linked to another barber.
  - Place both dictionaries in primitives, and add the missing ones.

### M27. The audit list misses actions, and the "skip rule" it relies on does not exist - Severity: Major

- **Lens:** `egm-structural`; `egm-codebase-details` (Nit)
- **Affected brief section:** D12 Audit (lines 795-804)
- **Issue:**
  - **Actions with no audit action:**
    - profile and photo edits, shops, and the «Който и да е» flag;
    - hours (a callable row or the governed trigger?);
    - ledger changes (delegate, waive, skip);
    - rehire, the self path, and «Завърши обучението».
  - **Two rows for one act.** The job's "one audit row" clashes with
    role-assignment's own `PROFILE_ROLES_CHANGED` row.
  - **There is no skip rule to reuse.** "The governed triggers skip writes
    a callable already audited" has a precedent only for `users`
    (`auditedByCallable`, `audit.system.ts:850-857`). For governed
    collections, the existing pattern joins through `writeOperationId`
    (`governed-change.system.ts:238-257`).
- **Recommendation:**
  - Give one action per callable, in a table.
  - Credit the job as the system (M1).
  - Replace "skip" with the `writeOperationId` join, or name a new skip
    rule per collection.

### M28. A draft that never went live can only leave as «Напуснал» - Severity: Major

- **Lens:** `egm-structural`
- **Affected brief section:** D2 lifecycle (lines 288-319); D10
- **Issue:** a mistyped or duplicate add stays forever as «Напуснал», and
  its offerings stay publicly readable on `services/*`.
- **Recommendation:** add «Изтрий» for a record that never went live. It
  removes the record, its offerings, roster, ledger and pending invite in
  one transaction, with an audit row.

### M29. Stage 0 is incomplete as listed - Severity: Major

- **Lens:** `egm-codebase-details` (Major), `egm-implementation-readiness`, `egm-structural`, `egm-design` (Nit)
- **Affected brief section:** Staging stage 0 (lines 865-880); D3 "three lists" (343-346)
- **Issue:**
  - **The stream has more consumers than listed.** "One ACTIVE-only
    stream feeds four screens" undercounts. `CatalogContentService.barbers()`
    also feeds:
    - the staff visit editor;
    - staff analytics names and scope (`analytics-screen-context.ts:69-72`;
      `staff-analytics.store.ts:291`);
    - the client card's link picker (`client-card.store.ts:2026-2034`), so
      DRAFT records cannot be linked from «Роли»;
    - the landing page (`landing-content.service.ts:48`);
    - the booking time sheet, schedule, review, bag and confirmed steps.

    D2's promises depend on assigning each consumer to one of the three
    lists.

  - **Missing files:**
    - `libs/infrastructure/firestore/src/lib/catalog.adapter.ts:50`;
    - `apps/functions/src/adapters/firestore-catalog.adapter.ts:107-108`;
    - `firestore-analytics.adapter.ts:209-213`;
    - `libs/ecs-core/src/testing/port-doubles.ts:573`, with its spec;
    - `booking-core-entities.type-spec.ts:52` and
      `booking-core-dictionaries.type-spec.ts:76-139`;
    - `landing-catalog.ts:27-122`;
    - the title readers `catalog.presenter.ts:135` and
      `service-detail-sheet.component.html:241, 335` (only `nx build web`
      sees templates);
    - `tools/seed-dev-catalog.mjs:423-425` and
      `apps/web/e2e/support/seed-firestore.ts`;
    - the `main.spec.ts` export table;
    - `docs/architecture/firestore-runbook.md:28`, `flatten-spec.md:741`
      and `designs/staff-analytics.md:447`.
  - **Booking specs need barbers.** The booking pipeline specs (book,
    reschedule, edit, read set) seed no barbers and need them once the read
    set reads barbers.
  - **The registration fix breaks a spec.** It breaks the property spec
    `registration.system.spec.ts:668-686` and the docstring at
    `registration.system.ts:113-118`. The web already sends `Email: null`
    (`client-onboarding.ts:574`), so the web and e2e are unaffected.
  - **The index needs no change.** The existing `(barberStatus, sortOrder)`
    index serves both queries (design), so "the index entry" should say
    that.
  - **The exit test is thin.** It omits the working period, the pool flag,
    the read rule and the registration change.
  - **No deploy order.** None is stated.
- **Recommendation:**
  - List every consumer with its target list, and add the missing files.
  - Add exit-test assertions:
    - a crafted registration call with another email is refused;
    - bookings before the start day and after the last day are refused;
    - «Който и да е» never assigns an out-of-pool barber;
    - a signed-out read of a DRAFT is denied.
  - State the deploy order (indexes, rules, functions, hosting together),
    and that a rollback needs a data rollback.
  - Move the `WriteProvenance` slice on `Barber` into stage 0 (M30).

### M30. Stage 1 is too large, its leaving exit test cannot run, and its inventory is missing - Severity: Major

- **Lens:** `egm-zoom-out`, `egm-implementation-readiness`, `egm-structural`; `egm-design`, `egm-comprehension` (Nit)
- **Affected brief section:** Staging stage 1 (lines 882-892); stages 4-5 (909-920); "Counter-argument kept on record" (115-120)
- **Issue:**
  - **The exit test cannot run in the emulator.**
    - The functions clock is `Date.now()` with no override
      (`main.ts:308-313`).
    - The e2e instant must fall on the real shop day
      (`suite-clock.ts:32-43`).
    - Scheduled exports run through `onSchedule`; existing e2e bypasses
      them by writing documents directly (`seed-firestore.ts:986-993`).
    - `signInAs` sets the claims itself, so an e2e cannot show that they
      were lost.
  - **The inventory is missing.**
    - No callable is named. Each new export changes pinned tables in
      `main.spec.ts` (export count, registry, digest-key binding, App
      Check).
    - `main.spec.ts:1686-1703` pins revocation to `setRoles`, and
      `:2256-2285` pins Admin Auth to the identity callables. The job,
      accept and the self path break these pins on purpose.
    - Not listed: the notification machinery (M15), the ledger entity,
      rules and `fieldOverrides`, the Storage staging rule, `Roles.TERMS`,
      the revoke binding, and the job's `SystemSource`.
    - `WriteProvenance` changes `Barber` again after stage 0's "one
      change", which is round-1 M26's complaint.
    - «Свържи акаунт» ships before the email check (stage 3), with no
      account lookup and no "not registered yet" copy.
  - **Items whose readers come later.**
    - Price copy and scaling serve only «Курсист» (stage 5).
    - Reminders are tested in stage 5.
    - Automatic go-live matters only when a newcomer finishes an item
      (stage 4).
    - The self path.
  - **The counter-argument is honoured only in stage order.** There is no
    go/no-go point for invites.
- **Recommendation:**
  - **Split stage 1:**
    - **1a:** the Team page, add sheet, editors without copy, activation,
      permissions, audit, and «Свържи акаунт» with a client lookup;
    - **1b:** «Напуска», the daily close, rehire, and the leftover lane.
  - Move copy, scaling and reminders to stage 5, and `WriteProvenance` to
    stage 0.
  - **Prove the close at pipeline level.** Use an `apps/functions`
    integration spec with a pinned `nowUtcMs`, following the precedent in
    `set-roles.integration.spec.ts:195-247`. Assert:
    - the roles, link, lock and roster changed;
    - `tokensValidAfterTime` moved;
    - a second run changes nothing.

    In e2e, cover only the "last day already past" path.

  - Name the test level of every exit test, and every callable with its
    codes.
  - Put a go/no-go decision on invites after stage 1 is in use, and
    consider merging stages 3 and 4.
  - «Свържи» copy: «Помоли {{name}} да влезе веднъж в приложението. После
    натисни „Свържи профил“.»

---

## Nit

### N1. The `shop` reservation is on the barber id, not the handle - Severity: Nit

- **Lens:** `egm-codebase-details`, `egm-structural`, `egm-implementation-readiness`; `egm-zoom-out` (Major)
- **Affected brief section:** D5 Handle (lines 430-432); "Where each finding went", N5 (163)
- **Issue:**
  - **The reservation is on the id.** `shop` is reserved as the barber-id
    scope of `AnalyticsGoalKey` (`ids.primitive.ts:233-252`).
  - **The collision cannot happen.** New ids come from `nextId`, a CSPRNG
    UUID (`crypto.adapter.ts:38-39`), so a collision needs ids built from
    the handle.
  - **The handle has no reader.** `Barber.handle` has no production reader
    (zoom-out). A uniqueness rule needs a key document, and no
    transliteration code exists.
- **Recommendation:**
  - State that barber ids are `nextId` UUIDs.
  - Drop the handle rule, and set `handle` to the id or drop the field.

### N2. The photo callable does not need an image library - Severity: Nit

- **Lens:** `egm-codebase-details`; `egm-zoom-out` (Major)
- **Affected brief section:** D5 Photo (lines 440-445); Risks (845-847)
- **Issue:**
  - `downscaleImage` returns width and height in the browser (null only on
    its fallback path, `downscale-image.ts:4-5, 24-37`).
  - `mediaBlurhash` is nullable (`media-ref.data.ts:27`).
  - `MediaRef.centerFocus` exists (`:40`).
- **Recommendation:**
  - The callable validates the client's dimensions with `MediaRef.parse`,
    copies the file, and stores the blurhash as `null`.
  - Drop the risk item.
  - Reusing the client avatar is the same callable with another source
    path.

### N3. Staff bookings do not ignore overlap today - Severity: Nit

- **Lens:** `egm-zoom-out`, `egm-design`
- **Affected brief section:** D3 (lines 341-342)
- **Issue:** the staff policy has `allowOverlap: false`; staff may
  double-book only after acknowledging it
  (`placement-policy.data.ts:15-16, 34-39`).
- **Recommendation:** "may still ignore hours and notice, and may overlap
  only after acknowledging it, as today".

### N4. The refusing adapter needs the `@launchBlocker` tag - Severity: Nit

- **Lens:** `egm-codebase-details`
- **Affected brief section:** D7 Sending (lines 520-522)
- **Issue:** preflight P7 checks `@emulatorOnly`; P8 checks
  `@launchBlocker` (`tools/verify/preflight/preflight.mjs:25-33, 159-165`).
  The refusing invite adapter blocks deploys only if it carries
  `@launchBlocker`.
- **Recommendation:** say so.

### N5. Setup ledger rules details - Severity: Nit

- **Lens:** `egm-implementation-readiness`, `egm-structural`, `egm-codebase-details`, `egm-zoom-out`
- **Affected brief section:** D5 ledger (lines 394-401); D11 Rules (779-782)
- **Issue:**
  - **It must be a named match.** It has to be `match /restricted/setup`; a
    wildcard would make the parity spec's `/restricted/{docId}` lookup
    ambiguous (`firestore.rules:575-578`;
    `role.rules-parity.spec.ts:96-100`). Named, it does not disturb the
    spec.
  - **Two comments go stale.** The comments at `firestore.rules:575-578`
    and `barber-link.entity.ts:15` say `restricted/` holds nothing else.
  - **The read needs a `get()`.** The linked-account read needs one
    `get()` of `users/{uid}` or of the lock.
  - **Nothing checks the read list.** No check covers the admin-only read
    list.
- **Recommendation:**
  - Use the named match and update both comments.
  - Pick the `get()` target and add rules integration cases.
  - Pin the admin clause to `Roles.ASSIGN` in the parity spec.

### N6. Accept details - Severity: Nit

- **Lens:** `egm-design`, `egm-codebase-details`
- **Affected brief section:** D7 Accepting (lines 546-574)
- **Issue:**
  - **A retry must stay read-only.** A retry on an ACCEPTED invite must
    not re-apply the union, or it could restore roles to someone who has
    since left, within the 30 days before purge.
  - **No session row.** The minted token has no `IDENTITY_SESSION_ISSUED`
    row, as `verifyOtp` writes (`verify-otp.pipeline.ts:287-306`).
  - **No replay detection.** Invite create has no `writeOperationId` for
    double-tap replay detection.
- **Recommendation:** state each.

### N7. Cost table gaps - Severity: Nit

- **Lens:** `egm-design`, `egm-structural`, `egm-codebase-details`
- **Affected brief section:** Cost (lines 816-826); D9 (699-701)
- **Issue:**
  - **Missing rows:**
    - the daily job and reminder reads, about one per barber per day;
    - the go-live writes;
    - one rules `get()` per ledger read.
  - **Wrong or inconsistent figures:**
    - "none extra" is wrong;
    - ~33 against D9's "about 30";
    - the readiness reads apply only while the record is DRAFT.
- **Recommendation:** add the rows and use one figure.

### N8. Bulgarian copy - Severity: Nit

- **Lens:** `egm-comprehension`
- **Affected brief section:** D8 stage table (lines 591-600), add sheet, account block; D9 (697); D6 (450)
- **Issue:**
  - **No gender field.** The presenter cannot choose between «Поканен» and
    «Поканена», or «Курсист» and «Курсистка», and the same holds for
    «Готов», «Напуснал» and «записван».
  - **Two words for one thing.**
    - «акаунт» against «профил» (the existing «Профили за вход»,
      `bg.json:2280`);
    - «Свържи сега» against «Свържи акаунт» for one action.
  - **A bare «Отмени».** It reads as "dismiss".
  - **Missing strings:** the pool toggle label, the «Курсист» warning, and
    the blocked-account explanation.
  - **A line for a card that never shows.** «Работи под надзор» is meant
    for a public card that a STAFF_ONLY student never has.
- **Recommendation:**
  - Use neutral forms: «Поканата е изпратена · изтича на 20 ноем.»,
    «Всичко е готово», «Напусна на 31 дек.», «Клиентите ще могат да
    записват {{name}} от 1 декември.»
  - Use «Свържи профил», «Отмени поканата» and «Напускане».
  - Add «Приема „Който и да е“» and «Ще вижда всички записи и профилите на
    клиентите.»
  - Use one string, «Поканата не е изпратена · Опитай пак», for lines 518
    and 592.

### N9. «В отпуск до …» needs a system rule - Severity: Nit

- **Lens:** `egm-comprehension`
- **Affected brief section:** D10 recipes (line 728)
- **Issue:** which closed days count as leave, and which card shows it, is
  a decision (Law 10.2).
- **Recommendation:** a system returns the leave span; the presenter words
  it.

### N10. Internal consistency - Severity: Nit

- **Lens:** `egm-zoom-out`, `egm-structural`, `egm-comprehension`, `egm-codebase-details`
- **Affected brief section:** as listed
- **Issue:**
  - **Lines that disagree:**
    - D9's "two groups" table has three rows (664-670).
    - D5 lets the newcomer own Name (382), though it is required at
      «Добави» (423).
    - D3 (343-345) says the Team page reads DRAFT; D8 (602-603) says every
      status. The page needs DEPARTED too.
  - **The add sheet.** D8 (605-610) omits shops, which D5 (435-436) says
    are picked there. With the copy source, owners and go-live, it is six
    to nine controls, not four. «Иван ще попълни…» is wrong when no email
    is given.
  - **Names and coverage.**
    - `Roles.TERMS` (413) gates shops, period, status and the pool flag
      too; name it for the whole row.
    - The permission table (407-411) has no content-editor or sysadmin
      column.
    - `EmploymentSystem` appears only in D11 (761).
  - **Lifecycle shape.**
    - There are three stamps for four states (290-292).
    - What happens to `barberLiveAtUtcMs` on `STAFF_ONLY` → `PUBLIC` is
      unstated.
    - Name the component (`BarberLifecycle`, a `*.data.ts`).
    - State that `barberJoinsAnyPool` is a root field on every state, read
      only in two.
  - **The Words table lacks:** Team page versus the public «Екип», member
    page, add sheet, go-live, staff home, preset, proven email,
    `askerTier`, stage tag, lane.
  - **Round-1 nits left open.**
    - N4: there is no tie rule, and "0,50 €" ties rounding to one
      currency; rounding of lengthened durations is unstated.
    - N6: `verdictOf` answers one service on one date, but "why nobody can
      book them" needs a summary over all services and days.
- **Recommendation:** fix each in the next revision.

---

## Round-1 resolutions not fully closed

Verdicts merge the reviewers' calls; where they differed, the stricter
verdict that the evidence supports is used.

| Round-1 finding                 | Verdict                                  | Reason                                                                                                                                | Now        |
| ------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| B2 server enforcement           | partly closed                            | Staff edits of leftover bookings are trapped; `verdictOf` cannot decide offerings from an id; the stream's consumers are undercounted | M12, M29   |
| B5 unproven email               | partly closed                            | The proof assumes the client cannot change its Auth email; "never `email_verified`" removes a defence                                 | M5         |
| M1 departure                    | not closed                               | Sessions are never revoked; the job has no lawful caller; the empty role set; no failure path                                         | B1, M1     |
| M3 ledger owner                 | partly closed                            | The ledger's invite pointer is a second source of truth and goes stale; no reset on rehire                                            | M4, M7     |
| M4 triage and tiers             | partly closed                            | The needed group is empty by default; the add sheet is more than four fields                                                          | M18, N10   |
| M5 roles to go live             | partly closed (text contradicts itself)  | A pending invite still gates going live                                                                                               | M10        |
| M6 barber shape                 | partly closed                            | The `LocalizedText` shape is deferred and contradicts the type                                                                        | M23        |
| M7 shops                        | partly closed                            | No stored shape for "every shop"; no roster hook                                                                                      | M24        |
| M8 photo                        | partly closed                            | A DRAFT face is public; the staging writer rule is unstated; the library is not needed                                                | M8, N2     |
| M9 permissions                  | partly closed                            | Day-exception writes cannot be gated as stated                                                                                        | M9         |
| M10 invite reads                | partly closed (resolution partly wrong)  | The derived id must be keyed; no admin list callable                                                                                  | M2, M13    |
| M12 delivery                    | partly closed                            | No state for an unsent invite; secret binding unstated                                                                                | M6         |
| M13 uniqueness, TTL             | partly closed (resolution partly wrong)  | Unkeyed hash; the TTL field never fires; re-invite semantics                                                                          | M2, M3, M4 |
| M14 invite cost                 | partly closed                            | No go/no-go gate; the scope grew back (hint, seven answers, delivery fields, ledger pointer)                                          | M30        |
| M15 apprentice                  | partly closed                            | The reminder's condition cannot be computed and has no data shapes                                                                    | M15        |
| M17 audit                       | partly closed                            | The action list is incomplete; the skip rule does not exist; the job credits an admin who did not act                                 | M27, M1    |
| M18 Team list                   | partly closed                            | The read path cannot be built; tags are not one per member                                                                            | M13, M14   |
| M19 newcomer steps              | partly closed                            | The wrong-email state cannot be built; unregistered and shared-device states are missing                                              | M19        |
| M20 going live                  | partly closed                            | «Пусни сам» brings back the ambiguity; notification topics and recipients are undefined                                               | M11, M15   |
| M21 two profile flows           | partly closed                            | No mechanism for the skip; the client completion row remains                                                                          | M20, M21   |
| M22 email mismatch              | partly closed                            | The never-registered case is missing; former member cannot be computed; dead end for staff without a record                           | M16        |
| M23 missed outcomes             | partly closed                            | Rehire by email cannot be built; the owner case adds code a no-email record avoids                                                    | M16, M22   |
| M24 public reads                | partly closed                            | Rehire to DRAFT hides names; Storage media; by-id queries                                                                             | M7, M8     |
| M25 personal data               | partly closed                            | The TTL never fires; the email digest outlives erasure                                                                                | M2, M3     |
| M26 staging                     | partly closed                            | Stage 1 too large; exit tests not runnable; `Barber` changed twice                                                                    | M29, M30   |
| M27 structure                   | partly closed (remaining items are nits) | Small duplicates and table mismatches                                                                                                 | N10        |
| M28 names                       | partly closed                            | Missing codes and dictionaries; two dictionaries in the wrong tier                                                                    | M26        |
| N2 Bulgarian labels             | partly closed                            | No pool toggle label; gendered titles                                                                                                 | N8         |
| N4 copy arithmetic              | partly closed                            | No tie rule; currency-bound step; duration rounding unstated                                                                          | N10        |
| N5 reserved `shop`              | not closed (resolution wrong)            | The reservation is on the barber id, and ids are UUIDs                                                                                | N1         |
| N6 after going live             | partly closed                            | The verdict answers one service and one date only                                                                                     | N10        |
| N8 migration inventory          | partly closed                            | About a dozen files missing; no deploy order                                                                                          | M29        |
| N9 analytics                    | partly closed                            | Rostered minutes keep counting after leaving unless the roster is closed                                                              | M1         |
| Counter-argument (invites wait) | partly honoured                          | Honoured in stage order, not as a decision gate                                                                                       | M30        |

Closed, by the reviewers' account: B1, B3, B4, M2, M11, M16, N1, N3, N7,
N10, N11.

## Claims verified in code by the synthesizer

| Claim                                                                                                                     | Evidence                                                                                                                             | Verdict                                                                                                                          |
| ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| Rules read roles from the token's `roles` claim                                                                           | `firestore.rules:32-36`                                                                                                              | Confirmed                                                                                                                        |
| Callable gates judge the token's `roles` claim only                                                                       | `apps/functions/src/lib/booking/caller-roles.ts:5-14`                                                                                | Confirmed                                                                                                                        |
| `setRoles` revokes refresh tokens after its commit, and a retry finishes a failed revoke                                  | `libs/ecs-core/src/pipelines/set-roles.pipeline.ts:72-81, 287-301`                                                                   | Confirmed                                                                                                                        |
| The revoke port is handed to `setRoles` only, by design                                                                   | `apps/functions/src/adapters/auth-claims.adapter.ts:22-24, 120-139`                                                                  | Confirmed                                                                                                                        |
| `decide` refuses a caller without `Roles.ASSIGN` or blocked, refuses self, refuses an empty set                           | `libs/ecs-core/src/systems/role-assignment.system.ts:196-212`                                                                        | Confirmed                                                                                                                        |
| `admitTarget` refuses a blocked account (brief D7 line 555)                                                               | `role-assignment.system.ts:133-150`                                                                                                  | Wrong: it checks missing, erased, unregistered and sysadmin; it is not exported                                                  |
| A link requires the `barber` role after the call                                                                          | `role-assignment.system.ts:274-279`                                                                                                  | Confirmed (so «Гост бръснар» with no roles cannot be linked)                                                                     |
| Removing `barber` clears the link and releases the lock                                                                   | `role-assignment.system.ts:292-293, 301-315`                                                                                         | Confirmed                                                                                                                        |
| `HashPorts` is plain sha256; contact-derived ids use a keyed HMAC (OR-26)                                                 | `apps/functions/src/adapters/crypto.adapter.ts:30-32, 71-86`; `libs/ecs-core/src/ports/tx.port.ts:136-149, 170-185`                  | Confirmed                                                                                                                        |
| `nextId` is a CSPRNG UUID (round-1 unverified item)                                                                       | `crypto.adapter.ts:38-39, 71-74`                                                                                                     | Confirmed                                                                                                                        |
| The TTL field is the adapter-stamped `purgeAt` Timestamp; no `staffInvites` group                                         | `apps/functions/src/adapters/firestore-ttl.adapter.ts:7-21`; `firestore.indexes.json:1015-1056`; `.claude/rules/firestore-layout.md` | Confirmed                                                                                                                        |
| `users.roles` has its single-field indexes switched off                                                                   | `firestore.indexes.json:1005-1009`                                                                                                   | Confirmed                                                                                                                        |
| Day exceptions are client writes under `mayEditRoster()`, zero reads by design; the planned narrowing concerns exceptions | `firestore.rules:58-74, 610-631`                                                                                                     | Confirmed; `barberSchedules` has no client writer (`:597-607`), so the brief's citation for the roster callables is partly right |
| `restricted/link` is a named deny-all match, and its comment says `restricted/` holds nothing else                        | `firestore.rules:564-582`                                                                                                            | Confirmed                                                                                                                        |
| `barbers` and `services` are publicly readable                                                                            | `firestore.rules:559-566`                                                                                                            | Confirmed                                                                                                                        |
| `media/**` is publicly readable with no client writer                                                                     | `storage.rules:67-70`                                                                                                                | Confirmed                                                                                                                        |
| Staff placement ignores overlap (brief D3 line 341)                                                                       | `libs/ecs-core/src/components/placement-policy.data.ts:15-16, 34-39`                                                                 | Wrong: `allowOverlap: false`; overlap only after acknowledgement                                                                 |
| `shop` is reserved, relevant to the handle (brief D5 line 432)                                                            | `libs/ecs-core/src/primitives/ids.primitive.ts:233-252`                                                                              | Wrong field: the reservation is on the barber id                                                                                 |
| P7 checks `@emulatorOnly`, P8 checks `@launchBlocker`                                                                     | `tools/verify/preflight/preflight.mjs:25-33, 159-165`                                                                                | Confirmed                                                                                                                        |
| Notification topics are a closed set with one production writer                                                           | `libs/ecs-core/src/components/notification-payload.data.ts:18-46`                                                                    | Confirmed                                                                                                                        |
| `SystemSource` has no value for a scheduled job                                                                           | `libs/ecs-core/src/components/actor.data.ts:27-45`                                                                                   | Confirmed                                                                                                                        |
| Schedules fire on `Europe/Sofia`; pipelines read the default location's zone; four schedules exist                        | `apps/functions/src/lib/cron-zone.ts:1-11`; `apps/functions/src/main.ts:1095, 1101, 1212, 1274`                                      | Confirmed                                                                                                                        |
| A busy day holds minute blocks only, no appointment ids                                                                   | `libs/ecs-core/src/entities/barber-busy-day.entity.ts:28`; `libs/ecs-core/src/components/minute-block.data.ts:32`                    | Confirmed                                                                                                                        |
| `LocalizedText` requires both languages, non-blank, and serves the barber's name, title and bio                           | `libs/ecs-core/src/components/localized-text.data.ts:4-34`                                                                           | Confirmed                                                                                                                        |
| Blurhash is nullable, a centred focus helper exists, and the browser downscaler returns dimensions                        | `libs/ecs-core/src/components/media-ref.data.ts:22-27, 40`; `libs/infrastructure/storage/src/lib/downscale-image.ts:4-5, 24-37`      | Confirmed                                                                                                                        |
| The web registration form sends no email (round-1 unverified item)                                                        | `libs/features/client/onboarding/src/lib/client-onboarding/client-onboarding.ts:574`                                                 | Confirmed: `Email: null`; only crafted calls can send one                                                                        |
| `provisionAuthUser` sets the Auth email only from the destination, without `emailVerified`                                | `auth-claims.adapter.ts:89-95`                                                                                                       | Confirmed                                                                                                                        |

## Unverified items carried by reviewers

- Whether ID tokens from a custom-token sign-in carry `email` (M5).
- Whether a signed-in client of this project can change its own Auth email
  through `accounts:update`, which depends on the email-enumeration
  protection setting and on custom-token users (M5).
- Whether custom-token claims persist across refresh until revoked. The
  `setRoles` design assumes they do (B1).
- Whether the rules engine proves `barberStatus != 'DRAFT'` from `==` and
  `in` query constraints, and how it treats a client `documentId() in`
  query (M7).
- Whether one rules `get()` per write fits the access-call limit for a
  366-day exception batch (M9).
- Whether the staff `barberStatus in [...]` query with `orderBy(sortOrder)`
  is served by the existing index. Design says yes; others left it open.
- Whether the analytics radars drop barbers with no figures, and the
  utilisation denominator for DRAFT and STAFF_ONLY rosters.
- How `/staff/schedule` behaves for `content_manager` today (M17).
- Whether Firestore TTL re-checks `purgeAt` when an expired document is
  overwritten (M4).
- Session behaviour in a mail app's built-in browser.
- Firestore and email-provider pricing and limits.
