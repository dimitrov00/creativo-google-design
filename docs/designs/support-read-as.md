# Support read-as

- **Status:** design, 2026-11-24; the owner answered both questions of §9 the same day: the walls hold inside a read-as, and only the sysadmin may start one.
- **Builds:** the read-as contract of OR-24
  (`docs/architecture/decisions/2026-10-26-owner-rulings.md`; `HANDOFF.md` §6).
- **Owner ruling it serves (2026-11-24):** `sysadmin`, the vendor's support
  account, keeps its walls (no client spend, no export or erasure, no role
  changes, no client's own notes). When support needs to see what a shop's
  owner sees, the only way is an audited, time-boxed, read-only read-as.

## 1. What it is

Support opens a person's page, says why, and gets up to 15 minutes in which
the app shows exactly what that person would see. Nothing can be changed:
every write is refused by the database rules and by the server functions. A
banner on every screen says whose eyes these are and offers «Край». The start
and the end are written to the audit log.

## 2. What exists today

- `startImpersonation` and `endImpersonation` callables, their pipelines
  (`libs/ecs-core/src/pipelines/start-impersonation.pipeline.ts`,
  `end-impersonation.pipeline.ts`) and `ImpersonationSystem`: they write an
  audited `impersonationSessions/{id}` row (`ACTIVE` → `ENDED`), refuse a
  self-impersonation, a blank reason, a bad expiry, an absent, erased or
  never-registered target, and admit only `Roles.ADMIN` callers (the admin
  and the sysadmin).
- `ImpersonationScope` (`READ` | `WRITE`), `Actor.impersonator(...)` and
  `Actor.canMutate` (false for a `READ` impersonator) — the audit vocabulary,
  unused by any session so far.
- No token, no rule, no banner: nothing consumes a session (DEP-F18).

## 3. How a session runs

1. **Start.** Support opens the person's page and taps «Виж като …». A
   sheet asks for the reason, which is required and stored. The web calls
   `startImpersonation` with `READ`, the target and an expiry 15 minutes on.
2. **The server** checks the caller, the target and the window, as today,
   plus one new rule: the window may not be longer than 15 minutes
   (`GOVERNANCE_IMPERSONATION_WINDOW_TOO_LONG`). In one transaction it
   writes the session and its audit row, as today. Then it mints a custom
   token whose `uid` is the TARGET. The token carries the target's own
   claims from their `users` document (`tenantId`, `stage`, `roles`, exactly
   as `AuthClaims.toToken` spells them) plus four read-as claims:

   | Claim      | Value                          |
   | ---------- | ------------------------------ |
   | `imp`      | the session id                 |
   | `impBy`    | the support account's uid      |
   | `impScope` | `READ`                         |
   | `impExp`   | the session's `expiresAtUtcMs` |

   `impExp` is an addition to OR-24's three. Firebase keeps a custom token's
   claims on every ID token of that session, including after its hourly
   refresh, so without it a read-as session would never end by itself. The
   rules and the server compare it with the clock.

   The answer gains `customToken`. The session's id is still `sessionId`.

3. **Swap.** The web signs the support account out and signs in with the
   token. Firebase keeps one signed-in user per browser, across its tabs, so
   support's own session ends here; after «Край» they sign in again. This is
   deliberate: two identities in one browser is how a support tool leaks
   one person's data into another person's session.
4. **Browse.** The app runs as the target, under the target's roles, so the
   menus, guards and homes are theirs. The banner sits above every page.
5. **End.** «Край» calls `endImpersonation` with the session id, under the
   read-as token, then signs out and opens `/auth`. Past `impExp` the app
   signs out on its own with the same words. A support account may also end
   a session from its own session, as today.

## 4. Nothing can be written

- **Firestore rules.**
  - `isSignedIn()` becomes "signed in, and not a read-as past `impExp`". Every
    rule that needs a person stops answering an expired session, reads
    included.
  - A new `notReadAs()` is added to every client write: the user's own
    profile fields, visit notes, photos, day exceptions and the three
    program collections.
- **Storage rules.** The same two checks on every upload and delete.
- **Callables.** The edge (`apps/functions/src/edge.ts`, `callableEdge`) reads
  the read-as claims before anything else. An expired session is refused
  (`GOVERNANCE_IMPERSONATION_EXPIRED`). A live one is refused on every
  callable except the reads, with `GOVERNANCE_IMPERSONATION_READ_ONLY`. Which
  callables are reads is a new total table,
  `apps/functions/src/lib/read-as-access.ts` (the edge's alone, so it never
  ships to the web), so a new callable fails to compile until someone
  decides:
  - **Open to read-as:** `staffAnalytics`, `listTeam` and `endImpersonation`
    (its own end).
  - **Closed:** everything else, including `previewClientErasure` and
    `exportClientData`, which are the owner's privacy acts.
- **Attribution.** `callerActor` returns `Actor.impersonator(impBy, target,
imp, READ)` for a read-as token. A refused call's outcome line therefore
  names the support account and the session, not the target. Nothing else is
  written under a `READ` session, so the start and end rows are its audit
  trail.

## 5. What support sees

The target's own view. Two things differ from the plain session:

- **The owner's walls** (ruled in §9: they hold). The rules add `notReadAs()` to the spend
  document (`clientStats/{id}/restricted/money`). The web hides the client's
  own words on visits under read-as, as it does for a sysadmin today
  (`Roles.readsClientWords`). The privacy callables are closed in any case
  (§4).
- **Nothing private to the device** follows the target: no saved search
  history, no remembered view, no cached analytics from before the swap.
  The swap clears what the sign-out clears today.

## 6. The banner

- **What it says.** A slim bar at the very top, above the page, in the
  warning tone: «Действаш като {name} · Край», «до 14:32».
- **Where the words come from.** The name is the ID token's `name` (the Auth
  record's display name, stamped at registration), falling back to the
  target's uid. The time is `impExp` on the shop's clock. Nothing is read
  from Firestore, as OR-24 requires.
- **Where it lives.** One component in the shared shell, mounted once in the
  app root (`apps/web/src/app/app.html`). It is drawn only when the token
  carries `imp`, and loaded on demand so the initial chunk does not grow.

## 7. Where support starts one

- **As built, a page of its own: `/support` («Поддръжка»).** The first
  plan was a row on the person pages (Team account and member pages, the
  client card). Building it showed the sysadmin cannot open those: its
  permissions are a fixed column with no team access
  (`StaffPermissions.SYSADMIN`), so a row there is unreachable for the one
  person allowed to use it.
- **How it works.** Support's door is a root page behind `Roles.SUPPORT`,
  reached from the menu's «Поддръжка» row. It reuses the Team's one lookup
  sheet (`lib-account-pick-sheet` over `AccountLookupStore`: name, phone or
  e-mail). A picked account opens the reason sheet («Виж като …»).
- **Clock drift.** The web asks for a 14-minute window, a minute under the
  cap, so a device clock slightly ahead of the server's never has the start
  refused.

## 8. Tests

- **ecs-core:** the window rule; the read-as claims' `toToken` / `fromToken`;
  the callable table's totality; `Actor` attribution under read-as.
- **Functions:**
  - the start answer carries a token whose claims are the target's plus the
    four;
  - the edge refuses an expired session and a write, and lets the reads
    through;
  - `endImpersonation` under the read-as token ends its own session and no
    other.
- **Rules (emulator):** a read-as token reads what its target reads, is
  refused every write in both rule files, is refused everything past
  `impExp`, and (if question 1 says so) is refused the spend document.
- **e2e:** a sysadmin opens a person's page, starts a read-as, lands as that
  person with the banner, is refused a write, taps «Край», and is on
  `/auth`.

## 9. Questions for the owner — RULED 2026-11-24

**Ruled:** (1) no — the walls hold inside a read-as; (2) the sysadmin only.
`Roles.SUPPORT` (`[sysadmin]`, callable-only like `Roles.ASSIGN`) gates both
callables and the «Виж като …» row; an admin is refused
(`GOVERNANCE_IMPERSONATION_FORBIDDEN`).

1. **Inside a read-as of the owner, does support see the owner's admin-only
   data?** That is the clients' spend, the export and erasure screens, and the
   clients' own notes.
   - _Recommended: no, the walls hold._ Support sees the owner's screens
     with those parts absent, as a sysadmin does today.
   - The other way, support sees everything the owner sees for 15 audited
     minutes. That is simpler, but it makes the ruling of 2026-11-24 true
     only outside a session.
2. **Who may start a read-as?**
   - _Recommended: the sysadmin only._ The ledger admits the admin too, but
     an owner already sees their shop through their own roles. Letting them
     step into a client's or a barber's account adds privacy risk for little
     gain.
   - The other way keeps today's gate (admin and sysadmin).

## 10. Not in v1

- **`WRITE` sessions.** The ledger keeps accepting them, but no token is
  minted for one; the start answers `GOVERNANCE_IMPERSONATION_SCOPE_NOT_OFFERED`.
- **A support search page.**
- **Read-as of an account with no `users` document.** The start already
  refuses it.
