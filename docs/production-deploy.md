# Production deploy — the checklist

Everything that has to happen before, during and after a production deploy of
Creativo: the web app on Firebase Hosting, Cloud Functions gen 2 (Node 22),
Firestore, Storage and Auth. It is for the owner and for any agent asked to
ship.

**The app has never been deployed.** `.firebaserc` still names the placeholder
project `creativo-replace-me`, and no hosted project exists yet
(`.firebaserc:2-11`, `docs/architecture/firestore-runbook.md:238`). Section 1
is therefore all still to do.

**Golden rule: run the preflight first, in both scopes.**

```bash
pnpm run preflight --project "$PROJECT_ID"
```

```bash
pnpm run preflight --scope functions --project "$PROJECT_ID"
```

> **No `--` before the flags.** Under the repo's pnpm
> (`packageManager: pnpm@9.15.9`), `pnpm run preflight -- --project …`
> forwards a literal `--` to the script, whose strict argument parser then
> refuses `--project` ("Unexpected argument") and exits 2. Pass the flags
> straight after the script name, as above (checked on 2026-10-26 with a dry
> `--scope bogus` run; the runbook, the HANDOFF gate and the preflight's usage
> line were corrected the same day). Source: `package.json:18`, `:31`;
> `tools/verify/preflight/preflight.mjs:1269-1279` (`optionsOf`).

The preflight is a read-only check that the project is ready (OR-35, DEP-F26).
Both predeploy hooks in `firebase.json` run it too and refuse the deploy if a
check fails. Run it by hand before you start, in both scopes as above, so a
failure doesn't land in the middle of a deploy. By hand it defaults to
`--scope web` (P1–P6, P10), so build the web first (`pnpm nx build web`) or P4
fails with "no built scripts"; only `--scope functions` (P1–P3, P6–P10) runs
P7, P8 and P9 (P10 runs in both). Without `--project` it falls back to
`$GCLOUD_PROJECT`, then to `.firebaserc`'s default. On a first deploy P2 and
P3 fail until the index deploy of section 3.1 has run; that is expected. P8 fails every functions
deploy until the OTP sender of section 1 lands — that is the point. P9 never
fails: it reports the platform backstops (PITR, backups, the audit sink and
its bucket) as `INFO` lines. P10 passes today (App Check ships `OFF`) and
refuses an `ENFORCE` the web cannot satisfy: the built bundle in the web
scope, the LIVE site in the functions scope (unreadable = FAIL; the App Check
section below). Its ten checks are:

| Check | Passes when                                                                                                       |
| ----- | ----------------------------------------------------------------------------------------------------------------- |
| P1    | `locations/loc-center` exists, the read guard admits it, and its `timeZone` is a canonical IANA zone              |
| P2    | all 7 `purgeAt` TTL policies are `ACTIVE`                                                                         |
| P3    | all 24 declared composite indexes are `READY` (indexes the file doesn't declare show as `INFO`, prune candidates) |
| P4    | the built web bundle contains no `REPLACE_ME` and names the project id                                            |
| P5    | the CSP `connect-src` names `https://us-central1-<id>.cloudfunctions.net` and no other callables host             |
| P6    | no `*EMULATOR*` variable is set, and the project isn't the placeholder or a `demo-*` project                      |
| P7    | every use of an `@emulatorOnly` export in `apps/functions/src` sits behind `onEmulator()` (functions scope only)  |
| P8    | no `@launchBlocker` export in `apps/functions/src` is used at all (functions scope only)                          |
| P9    | always — informational: reports PITR, the backup schedules, the audit sink and its bucket (functions scope only)  |
| P10   | `config/app-check.json`'s mode is `OFF` or `MONITOR`, or `ENFORCE` and the web carries the site key (both scopes) |

The `@emulatorOnly` exports are the console OTP sender (`consoleOtpSender`),
the fixed-code OTP crypto (`fixedCodeOtpCryptoPorts`) and its code
(`OTP_FIXED_CODE`). P7 follows each use back to the tagged declaration
through renamed imports, re-exports and namespaces, so a rename can't hide
one; a use inside another tagged declaration is judged where that one is
used. It judges a run-time `import()` or `require()` of a module that exports
one (declared or re-exported, a barrel included) at the load, and refuses a
load whose specifier isn't a literal. The tag anchors only on an exported
top-level `const` or `function`; anywhere else it fails, so it can't drop out
unnoticed. The one `@launchBlocker` export is the refusing OTP sender
(`refusingOtpSender`); P8 follows its uses the same way and fails on any use
at all, behind `onEmulator()` or not. Exit codes: 0 = pass, 1 = a check
failed, 2 = bad arguments. If P6 fails, P1–P3 and P9 are skipped; P7 and P8
read only the repository, so they run either way. P9 reads the names in
`tools/ops/names.env` (the ones the `tools/ops` scripts create) and turns
every read it cannot make into an `INFO … unreadable` line (audit-hardening
WS-6, plan RU-33): promoting it to a gate is the owner's call.
Source: `tools/verify/preflight/preflight.mjs:1-64`, `:110-113`, `:492-948`
(P7, P8), `:950-1147` (P9, `opsNamesOf` … `readBackstops`), `:1269-1291`,
`checkAppCheck` / `liveBundle` (P10); `config/app-check.json`;
`tools/ops/names.env`; runbook §3 (the preflight table and its bullets).

Set these once in the shell you deploy from:

```bash
export PROJECT_ID=your-firebase-project-id
```

Commands below use `$PROJECT_ID`. They write `firebase …`; the repo pins
`firebase-tools` 15.31.0 (`package.json:75`), the version the runbook's TTL
behaviour was checked against (`firestore-runbook.md:148`), so run them as
`pnpm exec firebase …` unless your global CLI is the same version. Each item
ends with its source. Items marked **decide** have no ruling in the repo yet,
so the owner has to make the call.

---

## 1. One-time project setup

### Project, plan, region

- [ ] **Create the Firebase project and upgrade it to Blaze.** The functions are
      gen 2 (`runtime: nodejs22`), they bind Secret Manager secrets, and three
      `onSchedule` jobs need Cloud Scheduler. None of these deploy on the Spark
      plan. The first `firebase deploy --only functions` offers to enable the
      APIs it needs (Cloud Functions, Cloud Build, Artifact Registry, Cloud Run,
      Eventarc, Pub/Sub, Cloud Scheduler, Secret Manager). Accept them.
      Source: `firebase.json:9-25`; `apps/functions/src/main.ts:290`
      (`LOG_DIGEST_KEY`), `:386` (`WALKIN_ID_KEY`), `:877-887`,
      `:996-998` (the `onSchedule` jobs).
- [ ] **Choose the Firestore location knowing that functions run in
      `us-central1`.** No export sets a `region` and there is no
      `setGlobalOptions`. The web calls `getFunctions(app)` with no region, and
      the CSP and preflight P5 pin `https://us-central1-<id>.cloudfunctions.net`.
      The database location can't be changed after it is created. Gen-2
      Firestore triggers need a location compatible with the database (a
      platform constraint), so `nam5` or `us-central1` is the simple choice. An
      EU database means first adding a region to every export, `getFunctions`,
      the `connect-src` host in `firebase.json` and the `functionsHost` in
      `check-csp.mjs`, all in one change. **decide** (the repo records no
      location decision).
      Source: `apps/functions/src/main.ts:200-205`;
      `libs/infrastructure/firebase-app/src/lib/firebase-app.provider.ts:121`;
      `firebase.json:41`; `tools/verify/csp/check-csp.mjs:170-173`.
- [ ] **Create the (default) Firestore database (Native mode) and the Storage
      bucket** before the first rules or functions deploy. P1–P3 read Firestore.
      The bucket is the project's DEFAULT one (the `storageBucket` of the web
      config): the web uploads avatars and visit photos there, and the admin's
      GDPR erasure (`eraseClient`) deletes a person's objects from it with the
      functions' default service account (runbook §3, "the GDPR erasure ships
      dark").
      Source: `docs/architecture/firestore-runbook.md:193-208`.

### Project id, hosting site, web config, CSP host

- [ ] **Replace `creativo-replace-me` in `.firebaserc`** (in both `default` and
      `targets`) with the real id. Then register it with the CLI yourself:

```bash
firebase use --add
```

- [ ] **Create the hosting site and map it to the `web` target:**

```bash
firebase hosting:sites:create creativo-web --project "$PROJECT_ID"
```

```bash
firebase target:apply hosting web creativo-web --project "$PROJECT_ID"
```

Hosting site ids are global across Firebase. If `creativo-web` is taken, pick
another id and put it in `.firebaserc` → `targets` → `<id>` → `hosting` →
`web` (the template comment calls it `<site-id>`).

Source: `.firebaserc:2-12`; P6 refuses the placeholder
(`tools/verify/preflight/preflight.mjs:23-24`, `:228-231` (`checkEnvironment`)).

- [ ] **Fill in the production web Firebase config.** Replace every
      `REPLACE_ME` in `apps/web/src/environments/environment.production.ts`
      (apiKey, authDomain, projectId, storageBucket, messagingSenderId, appId)
      with the values from Firebase console → Project settings → Your apps →
      Web. These values are public client config, not secrets. The production
      build swaps this file in for `environment.ts` (`fileReplacements`). P4
      fails if the built bundle still contains `REPLACE_ME`, or if no script
      names the project id as a string literal.
      Source: `apps/web/src/environments/environment.production.ts:8-15`;
      `apps/web/project.json:52-57`;
      `tools/verify/preflight/preflight.mjs:427-463` (`checkBundle`).
- [ ] **Point the CSP at the real callables host.** In `firebase.json`, change
      `https://us-central1-creativo-replace-me.cloudfunctions.net` to
      `https://us-central1-<PROJECT_ID>.cloudfunctions.net`. If the host is
      wrong, every callable (booking, OTP, staff) is blocked by `connect-src`.
      Edit `.firebaserc` first: `check-csp.mjs` compares `connect-src` with the
      host of `.firebaserc`'s default project (check (d)), and CI runs it on
      every push. Leave the App Check sources as they are (reCAPTCHA
      Enterprise's script and frames under `script-src` / `frame-src`, the
      token exchange `https://content-firebaseappcheck.googleapis.com` under
      `connect-src`; security hardening S-RU-23): check (f) refuses any
      change to them, and check (g) refuses a `redirects` entry on the web
      hosting entry, which would void their path scope. Then check it:

```bash
pnpm nx build web
```

```bash
node tools/verify/csp/check-csp.mjs
```

Source: `firebase.json:41`; `tools/verify/csp/check-csp.mjs:20-22`,
`:170-173`, `:312`, `APP_CHECK_SOURCES` (checks (f), (g));
`.github/workflows/ci.yml:64-65`; `docs/security/csp-baseline.md`
(Follow-ups, "The project id"; the policy's App Check sources); P5.

### Credentials on the deploying machine

- [ ] **Use Node 22.22.3 (`.nvmrc`) with pnpm 9** (`engines`: node
      `>=22.22.3 <23`, pnpm `>=9`; `packageManager: pnpm@9.15.9`). The functions
      predeploy runs `pnpm nx build functions`, and the runtime is `nodejs22`.
      Source: `.nvmrc:1`; `package.json:31`, `:130-133`; `firebase.json:20`,
      `:24`.
- [ ] **Sign the Firebase CLI in** (`firebase login`) as an account that may
      deploy to the project. The deploy itself uses this login; the preflight
      does not (next item).
- [ ] **Set up application-default credentials for the preflight**, signed in
      as Owner or Editor, or as an account with `roles/datastore.viewer` plus
      `roles/serviceusage.serviceUsageConsumer`, and `roles/logging.viewer`
      for P9's sink and bucket lines (without it P9 still passes, reading
      them as "unreadable"). `firebase login` alone is not enough. The
      step-1 index/TTL deploy also needs Owner or Cloud Datastore Index Admin.

```bash
gcloud auth application-default login
```

Source: `docs/architecture/firestore-runbook.md:148`, `:206`.

### Secrets

- [ ] **Create `WALKIN_ID_KEY` before the first functions deploy.**
      `commitBooking` and `staffEditAppointment` key walk-in record ids with
      HMAC-SHA-256 under this secret (OR-26). If the value is empty, every
      walk-in mint fails with a defect.

```bash
openssl rand -hex 32 | firebase functions:secrets:set WALKIN_ID_KEY --data-file=- --project "$PROJECT_ID"
```

> **Never rotate or delete it once walk-ins exist.** A new key mints new
> ids, and the desk then sees every returning walk-in as a new client
> record. Set it once and keep its current version enabled.

Source: `docs/architecture/firestore-runbook.md:233`;
`apps/functions/src/main.ts:378-399` (`WALKIN_ID_KEY`, `walkInKey`);
`docs/architecture/decisions/2026-10-26-owner-rulings.md:710`.

- [ ] **Create `LOG_DIGEST_KEY` before the first functions deploy that
      binds it.** Every callable but `reportClientIssues` binds this secret
      (audit-hardening WS-4.2): each call's one outcome line
      (`callable.completed` / `callable.refused` / `callable.failed`)
      carries `inputDigest`, an HMAC-SHA-256 of the decoded command's
      allowlisted ids, codes and numbers under this key — never a contact
      value or free text. A function deploy fails while the secret is
      missing. An empty value is not fatal: the line prints
      `inputDigest: null` and the call still answers.

```bash
openssl rand -hex 32 | firebase functions:secrets:set LOG_DIGEST_KEY --data-file=- --project "$PROJECT_ID"
```

> Rotating it is safe: only the digests written from then on change
> (they join log lines to each other, never to a document).

Source: `docs/architecture/firestore-runbook.md` deploy step 4;
`apps/functions/src/main.ts` (`LOG_DIGEST_KEY`);
`docs/architecture/flips/audit-hardening.md` §2.6.

### Sign-in: the OTP sender (LAUNCH BLOCKER)

- [ ] **Replace the refusing OTP sender with a real transactional sender.**
      A deployed project wires `refusingOtpSender`: it sends nothing and
      refuses each code request that reaches it with
      `IDENTITY_OTP_SEND_UNAVAILABLE` (`failed-precondition`; the sign-in
      screen says codes aren't being sent yet and offers no retry). The
      refused request still saved its challenge and used up the resend
      window, so a repeat for the same destination inside that window
      answers `IDENTITY_OTP_RATE_LIMITED`, whose words say a code was already
      sent though none was. Until this is replaced, nobody can sign in,
      staff and admins included. The console sender (`consoleOtpSender`,
      which writes `[otp] would send <channel> OTP to <destination>: <code>`
      to the log) runs only under the emulator, so no deployed project logs a
      code or a destination. What to build:
  - an adapter implementing `OtpDeliveryPorts.sendOtp` for both channels
    (`OtpDestinationType.Email` and `Sms`) over a transactional provider (the
    console adapter's comment suggests Postmark or Twilio);
  - bind it in `identityPorts` in place of `refusingOtpSender()`, in the
    deployed branch of the emulator switch, the way the OTP crypto beside it
    is bound —
    `...(onEmulator() ? consoleOtpSender(telemetry.log) : <real sender>(…))` —
    so the emulator keeps the console sender. The preflight's **P8** refuses
    every functions deploy until then: `refusingOtpSender` is tagged
    `@launchBlocker`, and P8 fails on any use of it (followed through renames
    and re-exports). **P7** already passes: `consoleOtpSender` is tagged
    `@emulatorOnly` and is used only behind `onEmulator()`; keep that tag,
    and tag any new emulator-only adapter the same way (in its JSDoc, on the
    exported `const` or `function` itself). In the same change, delete the
    refusing adapter (or drop its last use) and flip the pin in
    `preflight.spec.mjs` ("P8 refuses today’s functions on main.ts’s
    refusing sender alone, …", and the fail-closed predeploy case beside it)
    to expect PASS;
  - declare the provider's keys with `defineSecret('<NAME>')` and bind them
    through `onCall({ secrets: [...] })` on the three callables that build
    `root.identity` (`requestOtpChallenge`, `verifyOtpChallenge`,
    `completeRegistration`, which share the one `identityPorts`), the way
    `WALK_IN_SECRETS` does, then set each one:

```bash
firebase functions:secrets:set <NAME> --project "$PROJECT_ID"
```

- add each new secret to `EMULATOR_SECRETS` so the emulator keeps working.

Source: `apps/functions/src/adapters/refusing-otp-sender.adapter.ts:5-25`;
`apps/functions/src/adapters/console-otp-sender.adapter.ts:6-54`;
`apps/functions/src/main.ts:333-347` (`identityPorts`), `:386-389`
(`WALK_IN_SECRETS`), `:504-538` (the three identity callables);
`apps/functions/src/edge.ts` (`IDENTITY_WIRE`);
`tools/flags/write-functions-env.mjs:99-102` (`EMULATOR_SECRETS`);
`tools/verify/preflight/preflight.mjs:859-907` (P7, `checkEmulatorOnly`),
`:909-948` (P8, `checkLaunchBlockers`).

- [ ] **Keep the login-OTP sender separate from any campaign or marketing
      sender (owner rule).** It gets its own provider account or sub-account,
      its own API-key secret, its own sending identity (a dedicated `auth.*`
      from-address and its own SMS sender id or number) and its own adapter
      file. Never send marketing through `OtpDeliveryPorts`, and never reuse
      this identity from a campaign adapter. No campaign sender exists today.
      Source: `apps/functions/src/adapters/console-otp-sender.adapter.ts:7-11`;
      `apps/functions/src/main.ts:336-340` (`identityPorts`).
- [ ] **Publish the provider's e-mail DNS records (SPF, DKIM, DMARC) for the
      `auth.*` sending domain**, and register an SMS sender id if the BG
      provider requires one. The provider defines these steps; the repo has no
      DNS config. **decide** (depends on the provider).
      Source: `console-otp-sender.adapter.ts:10-11`.

### Auth

- [ ] **Turn on Firebase Authentication (console → Authentication → Get
      started), but don't enable any sign-in provider.** The web signs in only
      with `signInWithCustomToken`, after the `verifyOtpChallenge` callable
      mints the token (OR-32 removed the popup and redirect resolver). Enabling
      Phone, e-mail link or Google would open a second sign-in path that skips
      the OTP limits.
      Source: `libs/infrastructure/firebase-auth/src/lib/otp-challenge.adapter.ts:1`, `:19`;
      `libs/infrastructure/firebase-app/src/lib/firebase-app.provider.ts:85-114`;
      `apps/functions/src/adapters/auth-claims.adapter.ts:58-80`;
      `docs/architecture/decisions/2026-10-26-owner-rulings.md:843-854`.
- [ ] **Authorized domains: leave them as they are for launch.** Custom-token
      sign-in uses no OAuth redirect or e-mail link. Add the production domain
      only if a redirect or popup provider is ever introduced.
      Source: OR-32 (as above).
- [ ] **Let the functions runtime service account sign custom tokens.** The
      Admin SDK runs with no key file (`initializeApp()`), so
      `createCustomToken` signs through IAM `signBlob`. Enable the IAM Service
      Account Credentials API and give the runtime service account (gen 2's
      default is `<PROJECT_NUMBER>-compute@developer.gserviceaccount.com`) the
      Service Account Token Creator role on itself. Without this, every OTP
      verify fails in production, and the emulator never shows it. This is a
      Firebase platform requirement inferred from the code path; the repo has
      no doc for it, so check the current Firebase Admin docs.

```bash
gcloud services enable iamcredentials.googleapis.com --project="$PROJECT_ID"
```

```bash
gcloud iam service-accounts add-iam-policy-binding "<PROJECT_NUMBER>-compute@developer.gserviceaccount.com" --member="serviceAccount:<PROJECT_NUMBER>-compute@developer.gserviceaccount.com" --role=roles/iam.serviceAccountTokenCreator --project="$PROJECT_ID"
```

Source: `apps/functions/src/adapters/auth-claims.adapter.ts:62`;
`apps/functions/src/lib/firebase-admin.ts:9`.

### Domain

- [ ] **Attach the custom domain** in Firebase console → Hosting (site
      `creativo-web`) → Add custom domain, then add the DNS records it asks for.
      Keep `Strict-Transport-Security: max-age=31536000; includeSubDomains`
      exactly as it is. **No `preload`** until the apex domain is final (OR-29,
      Deferred #10).
      Source: `firebase.json:47-50`;
      `docs/architecture/decisions/2026-10-26-owner-rulings.md:784`, `:1478`.

### Data retention, backups, cost

- [ ] **TTL policies.** No separate step: the 7 `purgeAt` policies are
      declared in `firestore.indexes.json` and created by the step-1 index
      deploy (section 3). They must read `ACTIVE` (P2) before functions deploy.
      Source: `docs/architecture/firestore-runbook.md` §2.2–§2.3.
- [ ] **Backups — decide.** Nothing turns them on by itself; the script
      is ready. Recommended (audit-hardening WS-6): Point-in-Time Recovery on
      (7 days of versions, the only window Firestore offers) and a daily
      backup schedule kept 28 days. `tools/ops/firestore-backups.sh` does both,
      idempotently: without `--apply` it only prints its `gcloud` commands
      (read them first); with it, it turns PITR on when off and creates the
      schedule when none exists. The preflight's P9 then reports both.
      Storage objects (media, avatars, visit photos) need their own policy,
      such as soft delete or versioning. This matters most during the
      hand-written bootstrap (section 2), which has no undo — so run it before
      section 2. Every window here also keeps an ERASED person's values: PITR
      for 7 days and each backup for 28 days hold the documents as they were
      before the erasure, and the bucket's soft-delete window (7 days by
      default on a new bucket) keeps a deleted avatar or visit-photo object,
      its `clientLabel` metadata included — a restore from any of them brings
      the person back, so re-run `eraseClient` for everyone erased since the
      restored instant (runbook §2.5, "Erased persons"; a legal call for
      counsel).

```bash
tools/ops/firestore-backups.sh --project "$PROJECT_ID"
```

```bash
tools/ops/firestore-backups.sh --project "$PROJECT_ID" --apply
```

Source: `firebase.json:2-8` (only rules and indexes configured);
`tools/ops/firestore-backups.sh`, `tools/ops/names.env` (`PITR_DAYS`,
`BACKUP_RECURRENCE`, `BACKUP_RETENTION`); runbook §2.5, §3 step 8.

- [ ] **Cloud Audit Logs (optional, decide).** Recommended (audit-hardening
      WS-6): Data Access `DATA_WRITE` and `ADMIN_READ` (never `DATA_READ`)
      for `datastore.googleapis.com` — the service name Google documents for
      Firestore's audit configuration, which covers
      `firestore.googleapis.com` too (plan RU-34) — and for
      `identitytoolkit.googleapis.com` (Firebase Auth; the name is
      unconfirmed: check it under IAM & Admin → Audit Logs first), routed to
      a separate 400-day bucket so the 30-day `_Default` promise below isn't
      affected. Two scripts, each printing its `gcloud` commands unless
      `--apply` is passed: `tools/ops/audit-logs.sh` (a read-modify-write of
      the IAM policy's `auditConfigs`; it prints the volume and billing
      caveat first — every Firestore write becomes a billable log entry, and
      the entries name principals by e-mail) and `tools/ops/log-sink.sh` (the
      bucket `creativo-audit-400d`, 400 days, and the sink
      `creativo-audit-sink`: Admin Activity and Data Access audit logs plus
      every Cloud Functions line, never a client issue — plan RU-36). Keeping
      account ids for 400 days needs a legal basis (plan §7 item 9).
      **Locking** the bucket (`--apply --lock`) is a separate decision and
      **irreversible**: the bucket can then never be deleted, and its
      retention only grows. The preflight's P9 reports the sink and the
      bucket. This began as a design-research launch-checklist item, not an
      owner ruling.
      Source: `docs/design-research/client-details-design.md:11430`, `:11451`;
      `tools/ops/audit-logs.sh`, `tools/ops/log-sink.sh`; runbook §2.5, §3
      step 8.

```bash
tools/ops/audit-logs.sh --project "$PROJECT_ID"
```

```bash
tools/ops/log-sink.sh --project "$PROJECT_ID"
```

- [ ] **Check the Data Access audit config by hand** once it is decided (the
      preflight's role set cannot read the IAM policy, so P9 does not report
      it — plan RU-33). Expect `datastore.googleapis.com` (and
      `identitytoolkit.googleapis.com`) with `DATA_WRITE` and `ADMIN_READ`:

```bash
gcloud projects get-iam-policy "$PROJECT_ID" --format='yaml(auditConfigs)'
```

- [ ] **Budget and alerts — decide the amount.** Google Cloud console →
      Billing → Budgets & alerts: a monthly budget with e-mail alerts. App
      Check ships `OFF` (the App Check section below): until the switch is
      at `ENFORCE` every callable is reachable without it, and only
      `reportClientIssues` is capped (`maxInstances: 2`). Once a site key
      ships, count the reCAPTCHA Enterprise assessments in (auto-refresh is
      about one per active tab per hour, plus one per call of the five
      limited-use callables) and, from `MONITOR` on, one App Check API
      round-trip per call of those five.
      Source: `apps/functions/src/main.ts` (`reportClientIssues`);
      `config/app-check.json`; security hardening §7 items 3, 14.

### Monitoring and privacy (owner's, OR-34)

- [ ] **Create the logs-based metrics and their alerts** after the first
      functions deploy: `tools/ops/log-metrics.sh` (runbook §3 step 7). It
      creates or updates `client_issue_count` (OR-34: filter
      `jsonPayload.clientIssueKind:*`, label `kind`, DELTA INT64 — the recipe
      this item used to spell out), and, recommended by audit-hardening WS-6,
      `trigger_attempt_failed` (labels `outcome`, `fn`), `document_refused`,
      `audit_actor_missing`, `callable_failed` (label `callable`) and, from
      security hardening S-WS-E, `roles_sessions_not_revoked`, then the
      alert policies of `tools/ops/alerts/` (client issues above 100 per
      5 minutes, as before; any PERMANENT trigger attempt or more than 10
      failing in 5 minutes; any refused document; any act without its audit
      row; more than 5 failures of one callable in 5 minutes; any roles
      change whose sessions were not revoked). Read the dry run first:

```bash
tools/ops/log-metrics.sh --project "$PROJECT_ID"
```

```bash
tools/ops/log-metrics.sh --project "$PROJECT_ID" --apply
```

- [ ] **Attach an e-mail notification channel** to each of the six alert
      policies in Cloud Monitoring → Alerting (the files name none).
      Source: `docs/architecture/firestore-runbook.md` §3 step 7;
      `tools/ops/log-metrics.sh`, `tools/ops/alerts/*.yaml`;
      `docs/architecture/decisions/2026-10-26-owner-rulings.md:915`.
- [ ] **Turn on Error Reporting notifications.** There is no Sentry or Pino
      (D11(a)): Cloud Logging plus Error Reporting is the only error channel
      for both server and client errors.
      Source: `apps/functions/src/adapters/console-telemetry.adapter.ts:11-28`;
      `docs/architecture/decisions/2026-10-26-owner-rulings.md:886`, `:1528`.
- [ ] **Data-subject requests (GDPR Art. 15 / 17) — know the path before
      lighting `client.privacy`.** The shop's `admin` (never the vendor
      `sysadmin`) serves them from the staff client card's «Лични данни»
      block, reached through a visit of the person: «Изтегли данните» saves
      ONE JSON file of the person's data (Art. 15 / 20); «Изтрий личните
      данни» shows the cascade in figures in ONE alert, then pseudonymizes
      the record and the account, deletes the sign-in account, the notes,
      the photos and the avatar, and keeps the visits, the money and the
      audit trail (Art. 17). A walk-in record sharing the person's phone or
      e-mail is offered as its own erase row ("Erase the record with the same
      phone or e-mail") — only while the person's own record still holds
      those values, so erase the siblings from the same card. A walk-in-ONLY
      person (no sign-in account) has a card of their own since security
      hardening S-WS-F (S-DEP-8): the visit editor's client search (a record
      result) or the person's walk-in seat opens the record's card, which
      shows the head and this block, the export and the erasure keyed by the
      record id. A person past
      the caps is refused, never served partly: the export at 20,000
      documents or 4 MiB (`PRIVACY_EXPORT_TOO_LARGE`), the erasure at 5,000
      documents in any one list (`PRIVACY_ERASURE_TOO_LARGE`) — both need a
      runbook procedure. A staff account is refused
      (`PRIVACY_ERASURE_STAFF_ACCOUNT`). What backups, PITR and the Storage
      soft-delete window keep is the backups item above.
      Source: `docs/architecture/firestore-runbook.md` §1.1 ("The export's
      reads", "The erasure's reads and writes"), §2.5;
      `docs/architecture/flips/audit-hardening-phase-3.md` §7 items 3, 4, 8, 11.
- [ ] **Publish the privacy-policy line:** "diagnostic data under legitimate
      interest, 30-day Cloud Logging retention, no personal identifiers". Keep
      the `_Default` log bucket at 30 days so the statement stays true.
      Source: `docs/architecture/decisions/2026-10-26-owner-rulings.md:919`;
      `docs/architecture/HANDOFF.md:2364-2374`.
- [ ] **reCAPTCHA on every page — disclosure, privacy line, pre-consent
      view (decide, before a site key ships).** Once
      `environment.production.ts` carries an App Check site key, every page
      (the public landing included) loads Google's reCAPTCHA Enterprise
      script and an invisible frame before any consent. Google's terms ask
      for the reCAPTCHA badge or a "protected by reCAPTCHA" disclosure; the
      privacy policy needs a line for it (Google processes the device's
      signals to tell people from bots); and whether loading it before
      consent is acceptable under GDPR is the owner's view to take. Nothing
      loads while the key is empty (today).
      Source: `libs/infrastructure/firebase-app/src/lib/app-check.provider.ts`;
      security hardening §7 item 7.
- [ ] **Grant the Storage rules agent its Firestore read, once.** Since
      security hardening S-DEP-4 an avatar upload's rule reads
      `users/{uid}` across services (section 3.2): the first
      `firebase deploy --only storage` asks to grant
      `roles/firebaserules.firestoreServiceAgent` to the Storage rules
      service agent. Deploy interactively once and answer yes, or grant the
      role beforehand; until it is granted every avatar upload is refused
      (fail-closed). One billed Firestore read per avatar upload.
      Source: `storage.rules` (`accountMayUpload`); security hardening §7
      item 10.

### App Check (staged: OFF → MONITOR → ENFORCE)

App Check is wired (security hardening S-WS-A) and ships **`OFF`**. The web
initialises it only when `environment.production.ts` carries a reCAPTCHA
Enterprise site key (`appCheck.siteKey`, PUBLIC client config like the
`firebase` block; `''` = not configured, nothing loads). The server side is
ONE switch, `config/app-check.json` (`development` `MONITOR`, `staging` and
`production` `OFF`), which the functions predeploy writes into
`.env.<projectId>` as `APP_CHECK_MODE=<mode>`:

| Mode      | What every callable and `reportClientIssues` does                                                                                                                                                                     |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `OFF`     | nothing — no outcome reported, nothing consumed, nothing refused (today's behaviour)                                                                                                                                  |
| `MONITOR` | verifies, and writes `appCheckOutcome` (`VALID`, `MISSING`, `INVALID`, `REPLAYED`) on each outcome line; the five limited-use callables consume their token; never refuses                                            |
| `ENFORCE` | `MONITOR`, and refuses `MISSING` / `INVALID` with `failed-precondition` / `APP_CHECK_REQUIRED` (the web words it "reload the page"), and a replayed token on the five limited-use callables with `APP_CHECK_REPLAYED` |

The five limited-use (replay-protected) callables are `eraseClient`,
`previewClientErasure`, `exportClientData`, `startImpersonation` and
`setRoles` (`CALLABLE_APP_CHECK_TOKEN`): the web asks a fresh limited-use
token per call and the server consumes it. A demo-only override
(`--app-check <MODE>` / `CREATIVO_APP_CHECK_MODE`) exists for the emulator
journeys; the writer refuses it for any real project, so a deploy carries
exactly the committed manifest. Preflight P10 refuses an `ENFORCE` the web
cannot satisfy. Debug tokens are not wired: a developer's own device only,
never in an environment file, a CI variable or the repo, and revoked in the
console after use. Do it in this order:

- [ ] **1. Create the key and register the app.** Google Cloud console →
      reCAPTCHA (Enterprise): a score-based **website** key for the
      hosting domains (the `web.app` site and the custom domain). Firebase
      console → App Check → register the web app with the reCAPTCHA
      Enterprise provider and that key. Billing is on (Blaze); confirm the
      assessment quota. Enable the **Firebase App Check API** on the
      project, and give the functions runtime service account the App Check
      token-verifier role (`roles/firebaseappcheck.tokenVerifier`, or any
      role holding the token-verify permission — confirm it in the console):
      the five consuming callables call the API to verify, and without the
      role they read `INVALID` on every call. Paste the PUBLIC site key into
      `apps/web/src/environments/environment.production.ts`
      `appCheck.siteKey` — every web deploy from then on ships it (step 3),
      so finish step 2 first (gitleaks has no rule for site keys; if it ever
      flags one, allowlist it — never bypass the hook).
- [ ] **2. Staging first.** The same with a staging key — a temporary,
      NEVER-COMMITTED edit of `environment.production.ts` for the staging
      build (no staging build configuration exists; P10 judges the edited
      file). In a real browser with the console open: no ENFORCED CSP
      violation — none from `connect-src` either (a host it shows missing
      joins `firebase.json` in the same change as the measurement); record
      the Trusted Types report-only samples of BOTH directives
      (`require-trusted-types-for`, `trusted-types`) and correct
      `RECAPTCHA_REPORT_ONLY_SINKS` / `RECAPTCHA_REPORT_ONLY_POLICIES`
      (`libs/infrastructure/firebase-app/src/lib/csp-baseline.ts`) if they
      differ; block `www.google.com` in DevTools (request blocking) and
      reload — the app must still work, its calls going out headerless
      (`MISSING`); at staging `MONITOR`, one real `exportClientData` reads
      `VALID`.
- [ ] **3. Deploy the web with the production key** (P10 passes at `OFF` /
      `MONITOR`). This is the CLIENT-side point of no return: from here every
      client loads reCAPTCHA whatever the server mode (a script that fails
      or times out leaves the page without App Check, its calls headerless
      — never hung). A key rolls back as `siteKey: ''` plus a web deploy.
      Wait for the service worker to roll the new shell out.
- [ ] **4. `MONITOR`.** Set `"production": "MONITOR"` in
      `config/app-check.json`; deploy functions only. Read the console's App
      Check → APIs → Cloud Functions verified share, and the log filter
      `jsonPayload.appCheckOutcome` on the outcome lines grouped by
      `jsonPayload.callable` (`reportClientIssues` writes no line of ours:
      read the platform's own `callable-request-verification` lines). Hold —
      at least 7 days of real traffic — until, PER CALLABLE, `MISSING` +
      `INVALID` + `REPLAYED` are under 1 % and each is explained (old tabs,
      blockers), and each of the five limited-use callables shows real
      `VALID` calls and no unexplained `INVALID` (the owner's bar; an
      aggregate would hide the five low-volume admin callables).
- [ ] **5. `ENFORCE`.** Set `"production": "ENFORCE"`; deploy functions
      only. P10 refuses it unless the LIVE web carries the key. A stale
      shell then reads `APP_CHECK_REQUIRED` ("reload"), never "sign in".
- [ ] **6. Firestore, then Storage.** Their App Check metrics at `MONITOR`
      (Firebase console → App Check → APIs), then the console's enforce
      switch for each (up to about 15 minutes to apply) — never code.
- [ ] **7. Rollback** at any step: `"OFF"` plus a functions-only deploy
      (section 6).

Source: `config/app-check.json`; `apps/functions/src/lib/app-check.ts`
(`APP_CHECK_MODE`), `apps/functions/src/edge.ts` (`callableEdge`);
`libs/ecs-core/src/ports/callables.ts` (`CALLABLE_APP_CHECK_TOKEN`);
`libs/infrastructure/firebase-app/src/lib/app-check.provider.ts`;
`tools/flags/write-functions-env.mjs`; `tools/verify/preflight/preflight.mjs`
(P10); `docs/security/csp-baseline.md`;
`docs/architecture/flips/security-hardening.md` §2.A.6, §7 items 3–6.

### Schedules and flags

- [ ] **Check that `CRON_TIME_ZONE` matches the shop.** The three nightly jobs
      (`sweepCapacityDaily` 03:00, `sweepClientStatsPolicyDaily` 03:30,
      `sampleBarberLeadTimeDaily` 04:00, each with `retryCount: 3`) fire on
      `'Europe/Sofia'`, a deploy-time constant. If `loc-center.timeZone` is a
      different zone, edit the constant before deploying functions.
      Source: `apps/functions/src/lib/cron-zone.ts:11`;
      `apps/functions/src/main.ts:877-887`, `:996-998` (the `onSchedule` jobs).
- [ ] **Review the production feature-flag map.** All 13 flags in
      `config/feature-flags.json` → `production` are `false` today, so loyalty,
      the client profile, pause, support, merge, privacy, referrals and
      discount grants ship dark. `client.privacy` gates the admin's GDPR
      export and erasure (`exportClientData`, `previewClientErasure`,
      `eraseClient` and the card's «Лични данни» block with its erase rows);
      it is on in `development` only, for the emulators and the e2e journeys. The
      web bakes the map in at build time. The
      functions get it from `.env.<projectId>`, which the predeploy writes. A
      real project gets the `production` map unless `FLAGS_ENV` / `--env` says
      otherwise. To light a flag: deploy functions first, then web. To turn one
      off: web first.
      Source: `config/feature-flags.json:32-46`;
      `apps/web/src/environments/environment.production.ts:2`;
      `tools/flags/write-functions-env.mjs:7-24`, `:109-118`;
      `apps/functions/src/lib/flags.ts:4-16` (callables refuse with
      `feature.off` while a param is off; enable a param before its web flag,
      disable it after).

---

## 2. Production data bootstrap

Every collection below has `allow write: if false` in the rules, and there is
no admin location writer (Deferred #8). **The Admin SDK (a one-off script) or
the Firestore console is the only writer.** Shape each body exactly like the
dev seed's fixtures (`tools/seed/fixtures/*.fixtures.ts`): the flat entity
minus `id`, every key present. Bodies that break the flat layout are refused
by the read guards (OR-33). **Never use `seed:dev` for this** (section 7).

The bootstrap's catalogue, settings and `users.roles` writes happen before
the first functions deploy, so they leave no governed or profile audit row
(the `audit…Changes` triggers do not exist yet); every later console or
Admin-SDK edit of those collections is recorded as `SYSTEM` / `ADMIN_SDK`
(audit-hardening WS-3, DEP-14).

- [ ] **`locations/loc-center`**, the default shop, with a canonical IANA
      `timeZone` (for example `Europe/Sofia`). It has to exist before the
      functions deploy: P1 runs in both predeploys. Without it, event saves are
      refused with `ENGAGEMENT_SHOP_EVENT_ZONE_UNKNOWN`. OR-35 keeps the id as
      `loc-center`. Model the body on the seed's `loc-center` fixture: every
      key of `ShopLocation` (meta, geo point, venue phone and cover slices):
      `name`, `shortName`, `address` (localized), `mapUrl`,
      `photos`, `openingHours` (seven days, Monday first: the envelope every
      barber's hours are clamped to), `timeZone`, `locationStatus`,
      `sortOrder`, and the flat geo, phone and cover fields.
      Source: `firestore.rules:539-542`;
      `libs/ecs-core/src/components/tenant-config.data.ts:20-24`;
      `libs/ecs-core/src/entities/shop-location.entity.ts:63`;
      `tools/seed/fixtures/catalog.fixtures.ts:172-208`;
      `docs/architecture/firestore-runbook.md:210-219`. Check it with:

```bash
pnpm run preflight --project "$PROJECT_ID"
```

- [ ] **The catalogue:** `serviceCategories`, `services`, `barbers`,
      `barberSchedules` (the weekly rosters), and any other shops in
      `locations`. Upload cover images and barber faces under Storage `media/**`
      with the console or the Admin SDK (no client writer). If the catalogue is
      empty, `/book` shows nothing.
      Source: `firestore.rules:524-563`; `storage.rules:54-57`;
      `tools/seed/fixtures/catalog.fixtures.ts`, `schedules.fixtures.ts`.
- [ ] **`settings/bookingPolicy` (optional).** If it is absent,
      `BookingPolicy.withDefaults` applies. Writing it fires
      `rebuildCapacityOnSettingsChange`.
      Source: `apps/functions/src/adapters/firestore-settings.adapter.ts:26-36`;
      `firestore.rules:750-757`; `tools/seed/fixtures/settings.fixtures.ts`.
- [ ] **The first admin, then the staff.** The FIRST admin is a console or
      Admin-SDK write (below): `setRoles`, the admin's audited roles change
      (security hardening S-WS-E), needs an admin to call it, and the rules
      never let a client write `users/{uid}`. Every later change — the
      staff, a second admin, a demotion — goes through `setRoles` (the staff
      client card's «Роли» block), which writes `users/{uid}.roles` with its
      own `PROFILE_ROLES_CHANGED` row and revokes the account's sessions; a
      console edit is audited only as `SYSTEM` / `ADMIN_SDK`. The sysadmin is
      never assignable through `setRoles`: it stays a console write. Roles
      reach the ID token only from the stored `users/{uid}.roles`, and only
      at sign-in. Steps for the first admin:
  1. The person signs in once through OTP and finishes registration. This
     needs the real OTP sender from section 1.
  2. With Admin credentials, set the root `roles` array on `users/{uid}` (for
     example `['admin']`, `['sysadmin']`, `['barber']`). Use only known `Roles`
     tags, never a nested or dotted field.
  3. The person signs out and back in, so `verifyOtpChallenge` (the
     `verifyOtp` pipeline) mints the new claims.

     The known tags are `client`, `barber`, `receptionist`, `content_manager`,
     `admin` and `sysadmin`; an unknown one is dropped from the token.
     Source: `firestore.rules:202-231`;
     `libs/ecs-core/src/pipelines/verify-otp.pipeline.ts:60-64`;
     `libs/ecs-core/src/components/role.data.ts:15-22`;
     `libs/ecs-core/src/components/auth-claims.data.ts:94-101`;
     `tools/seed/fixtures/users.fixtures.ts:30-40` (`registeredAccountBody`);
     `libs/ecs-core/src/pipelines/set-roles.pipeline.ts` (every later change).

---

## 3. Every deploy, in order

Deploys are manual, from a clean `main` whose CI is green. CI
(`.github/workflows/ci.yml`) has no deploy job and names no secret but
`GITHUB_TOKEN`. Its jobs run in parallel: `main` runs format, affected
lint/test/build/typecheck, the static CSP hash check, the icon checks,
`pnpm audit` and gitleaks; `static` the sync check, the layering check, the
seed-tools typecheck, the lint-rules tests, the style lint, the
initial-bundle guard and the functions build with its dependency check;
`runbook-gates` the runbook's §4 grep gates; `coverage` the ecs-core
coverage thresholds; `emulators` `pnpm run test:emulator`, then
`pnpm run verify:p0`, then `pnpm run verify:appcheck` (App Check under
`ENFORCE` and `MONITOR` on the Functions emulator); `e2e` `pnpm run e2e:web`
without the `@screenshot` tests, whose baselines are macOS renders (the
owner's macOS full gate runs them); `csp-smoke` the emulator CSP smoke
(`pnpm run verify:csp`).

This is runbook §3's ordinary order. Its Phase 4a exception (rules after
functions and hosting, `firestore-runbook.md:265-270`) protects a project
already serving a pre-4a web whose direct writes the tightened rules close;
a first deploy has no such web, so the ordinary order applies.

**The audit-hardening deploy, on a project already serving an older tree:
indexes → hosting → rules → functions** (runbook §3, "Audit-hardening";
plan §7 item 7). That is 3.1, then 3.4, then 3.2, then 3.3. The new web
goes out before the new functions because old functions ignore the extra
`operationId` every mutating call now sends, and the new photo stamp must be
live before the rules' stamp window. **Wire skew, accepted:** between the
hosting and the functions deploys the old `reportClientIssues` refuses the
new web's 12-key issue batches (those issues are lost, nothing else —
DEP-22); once functions are live, a tab opened before the hosting deploy has
its id-less booking calls refused until it reloads (DEP-4). Like the Phase
4a exception, this is moot for a first deploy.

**The security-hardening deploy (Phase 4), on a project already serving an
older tree: rules → functions → hosting** — the ordinary order (3.2, 3.3,
3.4; no index changes). The tightened Firestore and Storage rules go first
because the current web already complies with them (S-DEP-4, S-DEP-5); the
functions carry `setRoles` and write `APP_CHECK_MODE` (`OFF` for
production) into `.env.<projectId>`; the hosting serves the CSP with the
App Check sources and the web's App Check init, which loads nothing while
`appCheck.siteKey` is empty. Every later App Check flip is a functions-only
deploy, and P10 judges both predeploys (section 1, App Check).

### 3.0 The gate

- [ ] Run the full gate from `docs/architecture/HANDOFF.md` §4 (sync:check,
      layering, typecheck, lint, test, `test ecs-core --coverage`,
      `typecheck seed-tools`, build web, verify:bundle, build functions +
      check-functions-deps, the grep gates, `verify:p0`, `test:emulator`,
      `e2e:web`, `verify:appcheck`). Run the emulator journeys one at a time.
      Source: `docs/architecture/HANDOFF.md:2102-2133`.
- [ ] Run the CSP gate on its own, because it starts every emulator. A changed
      inline script (the pre-paint script, or Beasties output after an Angular
      update) changes the hashes, and the enforced CSP would then block it.

```bash
pnpm run verify:csp
```

- [ ] Make sure no emulator variable (`FIRESTORE_EMULATOR_HOST`,
      `FUNCTIONS_EMULATOR`, …) is set in the deploying shell, then run the
      preflight in both scopes (only the functions scope runs P7, P8 and
      P9):

```bash
pnpm run preflight --project "$PROJECT_ID"
```

```bash
pnpm run preflight --scope functions --project "$PROJECT_ID"
```

### 3.1 Indexes and TTL (additive)

```bash
firebase deploy --only firestore:indexes --project "$PROJECT_ID"
```

- [ ] Answer **No** to every offer to delete indexes or field overrides. Code
      that is still running may query them.
- [ ] Wait until P3 is PASS (all 24 composites `READY`). A query that runs
      before its composite is ready fails with `FAILED_PRECONDITION`, and only
      in production. Fallback:

```bash
gcloud firestore indexes composite list --project="$PROJECT_ID" --format="table(name.basename(),collectionGroup,state)"
```

- [ ] Wait until P2 is PASS (7 of 7 TTL policies `ACTIVE`: `otps`,
      `notifications`, `waitlistRequests`, `barberBusy`, `capacity`,
      `impersonationSessions`, `barberLeadTimeSamples`). `CREATING` means
      wait. Fallback:

```bash
gcloud firestore fields ttls list --project="$PROJECT_ID"
```

- [ ] `NEEDS_REPAIR` means the policy failed to apply, and a redeploy skips
      that field. Re-apply that group with runbook §2.2's fallback line,
      disabling first:

```bash
gcloud firestore fields ttls update purgeAt --collection-group="$GROUP" --disable-ttl --project="$PROJECT_ID"
```

```bash
gcloud firestore fields ttls update purgeAt --collection-group="$GROUP" --enable-ttl --project="$PROJECT_ID"
```

Source: `docs/architecture/firestore-runbook.md:135-180`, `:221-230`;
`firestore.indexes.json` (24 `indexes`, 120 `fieldOverrides`, 7 with
`ttl: true`).

### 3.2 Rules

```bash
firebase deploy --only firestore:rules,storage --project "$PROJECT_ID"
```

Rules ship before the code that depends on them. Appointments stay
callable-only. Since audit-hardening WS-3 (DEP-15) a team note
(`appointmentNotes`) and a visit photo (`appointmentPhotos`) are written only
under the caller's own uid (`authorUserId` / `takenByUserId`) with a
lifecycle stamp (`writtenAtUtcMs` / `takenAtUtcMs`) within five minutes of
the server's clock (`stampInWindow`), and a photo document is never
updated; a device whose clock is more than five minutes off is refused.
Source: `docs/architecture/firestore-runbook.md:229`; `firestore.rules`
(`stampInWindow`).

Since security hardening Phase 4 (S-DEP-5) each of those writes must also
name what it belongs to, and hold only its entity's keys
(`keys().hasOnly`): a team note's id is its visit's, and that appointment
must exist (one billed read per note save); a photo's id must be a UUID (its
one minter is the browser's `crypto.randomUUID()`), the appointment its body
names must exist (one billed read per photo), its `photoOrigin` must be
`SHOT` or `LIBRARY`, and a `SHOT`'s `path` must be
`appointmentPhotos/<appointmentId>/<photoId>`; a schedule exception
(`scheduleExceptions`) must sit under its body's busy key
(`<barberId>__<localDate>`, `localDate` shaped `YYYY-MM-DD`) — no read, so a
multi-day block stays one transaction. Deletes are unchanged. The web's own
writers already comply, so the rules can deploy before or after the hosting
that carries them; a document written by hand (console, script) under any
other id or with any other key is refused to a client — the Admin SDK
bypasses rules. Source: `firestore.rules` (the three blocks);
`libs/infrastructure/firestore/src/lib/rules-key-parity.rules-text.spec.ts`.

Since security hardening Phase 4 (S-DEP-4) an avatar upload reads the
uploader's account across services: `storage.rules` (`accountMayUpload`)
refuses a create or update under `avatars/{uid}/` when
`users/{uid}.accountStatus` is `ERASED`, or when there is no `users/{uid}`
document at all (fail-closed); a delete stays the owner's. That is ONE
billed Firestore read per avatar upload. The first deploy of these Storage
rules asks to grant the Storage rules service agent
(`service-<project number>@gcp-sa-firebasestorage.iam.gserviceaccount.com`)
the role `roles/firebaserules.firestoreServiceAgent` — run that deploy once
from a terminal and answer yes (or grant the role beforehand). A
`--non-interactive` deploy skips the question silently, and until the role
is granted every avatar upload is refused. Source: `storage.rules`
(`accountMayUpload`); `firebase-tools` `lib/rulesDeploy.js`
(`checkStorageRulesIamPermissions`).

### 3.3 Functions

```bash
firebase deploy --only functions --project "$PROJECT_ID"
```

The predeploy hook already runs, in order: `pnpm nx build functions`, then
`node tools/flags/write-functions-env.mjs` (the `production` flag map and
the `production` App Check mode, `APP_CHECK_MODE=<mode>`, into
`dist/apps/functions/.env.<projectId>`), then the preflight with
`--scope functions` (P1–P3, P6–P10). Don't set `FLAGS_ENV` for production.
The deploy fails closed if `loc-center`, the TTLs or the composites aren't
ready, if an emulator-only adapter (the console OTP sender, the fixed OTP
code) is wired outside the emulator (P7), while the refusing OTP sender is
still wired (P8), if the App Check mode is `ENFORCE` while the live web
carries no site key (P10), or if `WALKIN_ID_KEY` is missing.

The deploy holds 51 functions. Audit-hardening WS-3 (DEP-14) added thirteen
document-change audit triggers, one per governed collection, each retrying:
`auditSettingsChanges`, `auditServicesChanges`, `auditBarbersChanges`,
`auditLocationsChanges`, `auditBarberSchedulesChanges`,
`auditScheduleExceptionsChanges`, `auditCouponsChanges`,
`auditPositionsChanges`, `auditCoursesChanges`, `auditEventsChanges`,
`auditCustomersChanges`, `auditAppointmentNotesChanges` and
`auditAppointmentPhotosChanges`. Every write of those collections, deletes
included, writes one `GOVERNED_DOC_*` row to `auditLog` naming the changed
fields, never their values. `auditProfileChanges` keeps its name; its path
param is now `users/{docId}` (was `users/{uid}`), and it also records
`roles` and `accountStatus` changes (the path param's name is only the
pattern's wildcard: the trigger still fires on every `users` document).
Source: `firebase.json:19-23`; `docs/architecture/firestore-runbook.md:231`;
`apps/functions/src/main.ts` (`documentAuditTrigger`).

Audit-hardening Phase 3 (WS-C, P3-DEP-9) added the 48th: `exportClientData`,
the admin's GDPR export of one client's data (one JSON file, downloaded from
the staff client card). It is bound to `WALKIN_ID_KEY` and `LOG_DIGEST_KEY`
like the walk-in callables, and refuses `PRIVACY_UNAVAILABLE` until
`client.privacy` is lit, so it ships dark (the flag item above).
Source: `apps/functions/src/main.ts` (`exportClientData`);
`docs/architecture/firestore-runbook.md` §1.1 ("The export's reads") and §3.

Audit-hardening Phase 3 (WS-D, P3-DEP-15) added the 49th and 50th:
`previewClientErasure` (read-only: the census the card's alert prints) and
`eraseClient` (the admin's GDPR erasure — "pseudonymize, keep records";
`timeoutSeconds: 540`, `LARGE_MEMORY`, resumable: the card calls it again
until it answers done). Both are bound to `WALKIN_ID_KEY` and
`LOG_DIGEST_KEY` like the export, and refuse `PRIVACY_UNAVAILABLE` until
`client.privacy` is lit, so they ship dark too. `eraseClient` deletes Auth
users and objects of the default Storage bucket with the functions' default
service account: confirm its roles on the project (runbook §3).
Source: `apps/functions/src/main.ts` (`previewClientErasure`,
`eraseClient`); `docs/architecture/firestore-runbook.md` §1.1 ("The
erasure's reads and writes"), §2.5 and §3.

Security hardening (S-WS-E, S-DEP-6) added the 51st: `setRoles`, the
admin's audited roles change (the staff client card's «Роли» block). It is
bound to `LOG_DIGEST_KEY` like every traced callable (nothing new to
create), writes `users/{uid}.roles` and one `PROFILE_ROLES_CHANGED` row in
one commit, then revokes the target's refresh tokens (`auth.revokeRefreshTokens`)
so their next session is minted from the written roles. The revoke runs as
the functions' runtime service account — the one `eraseClient` deletes Auth
users as, so the same confirmation covers it (runbook §3). A failed revoke answers
`GOVERNANCE_ROLES_SESSIONS_NOT_REVOKED` with the roles committed and fires
the `roles_sessions_not_revoked` alert (the monitoring item below). The
admin's card keeps a retry (Save re-sends the stored set) only while the
admin's browser tab stays open; after a reload or on another device, revoke
with the Admin SDK as the functions' runtime service account —
`getAuth().revokeRefreshTokens('<targetUserId>')`, the uid from the log line
— or save any changed set from the card and then the original back (two
audit rows).
Source: `apps/functions/src/main.ts` (`setRoles`);
`libs/ecs-core/src/pipelines/set-roles.pipeline.ts`;
`docs/architecture/firestore-runbook.md` §3.

### 3.4 Hosting, straight after functions

The hosting predeploy does **not** build. It only runs the preflight with
`--scope web` (P1–P6, P10) over `dist/apps/web/browser`. A build carrying an
App Check site key is the client-side point of no return (section 1, App
Check, step 3). Build first:

```bash
pnpm nx build web
```

```bash
firebase deploy --only hosting:web --project "$PROJECT_ID"
```

Deploy functions and hosting back to back with no gap between them. They share
the callable wire (requests and `HttpsError(status, errorCode, details)`), so
an old web against new functions, or the other way round, can refuse calls.
Source: `firebase.json:26-34`; `docs/architecture/firestore-runbook.md:235`,
`:265-268`.

### 3.5 After the first functions deploy (once)

- [ ] Create the five logs-based metrics and their alert policies:
      `tools/ops/log-metrics.sh --project "$PROJECT_ID"`, read the dry run,
      then the same with `--apply` (section 1, Monitoring). The metrics count
      only lines written after they exist.
- [ ] If decided (section 1, Data retention): the backstops not yet applied
      — `tools/ops/firestore-backups.sh`, `tools/ops/audit-logs.sh`,
      `tools/ops/log-sink.sh`, each with `--apply`; never `--lock` without
      the owner's explicit word. Re-run the functions-scope preflight: P9
      lists what is in place.

---

## 4. Post-deploy verification

In a fresh browser profile on the production URL:

- [ ] **Guest:** the landing page and its map render. `/book` shows services
      and free times for `loc-center`. `/careers`, `/courses` and `/events`
      load.
- [ ] **Client:** request an OTP by phone and by e-mail, receive it from the
      **real** sender, and verify it. Landing on `/account` proves
      custom-token minting and the IAM grant.
- [ ] **Staff:** `/staff/schedule?view=agenda` loads. Open a visit sheet, and
      add and view a photo (Storage rules).
- [ ] **Admin:** `/admin` redirects to `/admin/loyalty/rhythm`, and
      `/admin/programs` loads.
- [ ] **Headers:** check the response headers on `/` and on a hashed chunk:
      CSP, CSP-Report-Only, HSTS, nosniff, Referrer-Policy,
      Permissions-Policy, COOP, X-Frame-Options and Cache-Control should match
      `firebase.json` (`/`, `/staff` and `/ngsw.json` are `no-cache`, hashed
      chunks are `immutable`). The DevTools console shows no CSP violation.

```bash
curl -sI "https://<domain>/"
```

- [ ] **Logs:** Cloud Logging has **no** `[otp] would send` line. The
      six metrics of `tools/ops/log-metrics.sh` exist
      (`gcloud logging metrics list --project="$PROJECT_ID"`). Error Reporting
      shows no new group.
- [ ] **The next morning:** the 03:00, 03:30 and 04:00 schedules ran without
      errors.
- [ ] Re-run the preflight.

Source: `apps/web/e2e/csp/csp-smoke.spec.ts:212-340` (the journeys this
mirrors); `firebase.json:35-102`; `docs/architecture/HANDOFF.md:2082` (the `/admin` redirect).
The emulator never enforces composites, TTL, IAM `signBlob` or real delivery,
so this manual pass is the only proof of them.

---

## 5. Pruning retired indexes

Only once functions **and** hosting from the new commit are live:

```bash
firebase deploy --only firestore:indexes --project "$PROJECT_ID"
```

Answer **Yes** to the deletions (`--force` answers yes for you). P3 lists the
candidates as `INFO` until then. On the first deploy there is nothing to prune
(OR-36). A stored-id change is never migrated: the affected collection is
wiped.
Source: `docs/architecture/firestore-runbook.md:236-238`, `:261-263`.

---

## 6. Rollback

- [ ] **Roll back web and functions as a pair, from the same previous green
      commit**, because the callable wire must match on both sides. Functions
      keep no versions, so check out that commit, rebuild the web (the
      hosting predeploy uploads whatever `dist/apps/web/browser` holds and
      never builds; the functions predeploy rebuilds functions itself) and
      redeploy:

```bash
pnpm nx build web
```

```bash
firebase deploy --only functions,hosting:web --project "$PROJECT_ID"
```

- [ ] **Hosting only:** Firebase console → Hosting → the `web` target's site
      (`creativo-web`, or the id you chose) → Release history → Roll back (but
      keep the pair rule above in mind).
- [ ] **Rules:** restore from the console's rules history, or redeploy
      `firestore:rules,storage` from the previous commit.
- [ ] **Escape hatch, emergencies only:** if the preflight can't judge the
      rollback, set `CREATIVO_SKIP_PREFLIGHT=1` for that one deploy, then run
      the preflight by hand afterwards in every scope that deploy skipped:
      the banner prints the exact command, `--scope` included, because a
      by-hand run defaults to the web scope and never runs P7 or P8. Never make it
      a habit.

```bash
CREATIVO_SKIP_PREFLIGHT=1 firebase deploy --only functions,hosting:web --project "$PROJECT_ID"
```

- [ ] **Flags:** turn the web flag off first, then the server param
      (`apps/functions/src/lib/flags.ts:11-13`).
- [ ] **App Check:** set the project's environment back to `"OFF"` in
      `config/app-check.json` and deploy functions only — nothing is
      verified, consumed or refused any more. A shipped site key rolls back
      as `appCheck.siteKey: ''` in `environment.production.ts` plus a web
      deploy (the page then loads no reCAPTCHA). Firestore and Storage
      enforcement are switched off in the console.
- [ ] **A CSP or shell change that has to reach every client now:** returning
      clients run the cached shell and policy for one service-worker cycle.
      Force the update (`SwUpdate`) or ship the `safety-worker.js` kill switch.
- [ ] Indexes are never pruned before section 5, so older code keeps its
      composites. A rollback doesn't undo data writes; that needs PITR
      (section 1).

Source: `docs/architecture/firestore-runbook.md:207`, `:265-267`;
`firebase.json:26-34`; `tools/verify/preflight/preflight.mjs:61-64`,
`:1313-1316` (`preflight()`'s `CREATIVO_SKIP_PREFLIGHT` branch);
`docs/security/csp-baseline.md` ("The service-worker header lag").

---

## 7. Never in production

- [ ] **Never run `pnpm run seed:dev` or `pnpm run dev` against the project.**
      The seed hard-codes `demo-creativo-test` and refuses to run outside
      `127.0.0.1` emulators. It writes fake clients, visits and staff
      accounts.
      Source: `tools/seed-dev-catalog.mjs:130-136`.
- [ ] **Never set `FUNCTIONS_EMULATOR` or any `*_EMULATOR_HOST`** in the
      deploying shell, in `.env.<projectId>` or in the runtime environment.
      Under `FUNCTIONS_EMULATOR=true` every OTP code is the fixed one,
      `devCode` is returned to the caller and the console sender writes every
      code to the log, which means anyone can take over any account. P6 refuses these variables in the shell.
      Source: `apps/functions/src/main.ts:277-278` (`onEmulator`), `:340-343`
      (`identityPorts`), `:511-512` (`requestOtpChallenge`);
      `tools/verify/preflight/preflight.mjs:127-128` (`EMULATOR_VARIABLE`),
      `:217-223` (`checkEnvironment`).
- [ ] **Never deploy the test `WALKIN_ID_KEY`.** `.secret.local` (a public
      TEST value) is written only for `demo-*` projects, and `firebase.json`'s
      `functions.ignore` keeps it and `.env.local` out of the upload. Keep
      those ignore entries. The functions predeploy rebuilds
      `dist/apps/functions` first, and the env writer's own comment says the
      build wipes that folder; even so, don't run a `demo-*` command
      (`pnpm run dev`, `e2e:web`, `verify:p0`, `verify:csp`) in the same tree
      between the build and a real deploy.
      Source: `firebase.json:11-24`; `tools/flags/write-functions-env.mjs:12-20`,
      `:99-102`, `:161-167`.
- [ ] **Keep `emulators.enabled: false`** in `environment.production.ts`. It
      also keeps the `window.__e2eSignIn` test hook unwired.
      Source: `apps/web/src/environments/environment.production.ts:16-23`;
      `apps/web/src/app/app.ts:22-30`.
- [ ] **Never rotate `WALKIN_ID_KEY`** (section 1), and **never answer Yes to
      deletions on the step-1 index deploy** (section 3.1).
- [ ] **Never deploy production with `FLAGS_ENV=staging`** (or
      `--env staging`): the predeploy would write the staging map into the
      production project's `.env.<projectId>`.
      Source: `tools/flags/write-functions-env.mjs:7-24`, `:109-118`.

---

## 8. Deferred security items to revisit

| Item                                                                 | State at launch                                                                                                                                                                                                                                                                          | Ruling                                                                                                                  |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| **App Check** on the callables and `reportClientIssues`              | Wired (security hardening Phase 4); the switch is `config/app-check.json`, shipped `OFF`, and the web loads nothing until `appCheck.siteKey` is set. Roll out `MONITOR` → `ENFORCE` per section 1 (App Check); Firestore and Storage enforcement stay console steps after the callables. | Deferred #4, built (`docs/architecture/flips/security-hardening.md` S-RU-17 … S-RU-32); `docs/security/csp-baseline.md` |
| **Trusted Types, enforced**                                          | Report-Only (`require-trusted-types-for 'script'`). Waits until the MapLibre sinks, the SW-registration report and the reCAPTCHA script injection (UNMEASURED) are gone or policied.                                                                                                     | Deferred #3 (`…owner-rulings.md:1471`); `firebase.json:43-46`                                                           |
| **HSTS `preload`**                                                   | Not set (close to irreversible). Add it once the apex domain is final.                                                                                                                                                                                                                   | Deferred #10 (`…owner-rulings.md:1478`); OR-29                                                                          |
| **Firestore connectivity probe** (`www.google.com` in `img-src`)     | Blocked: clients on a failing network report an `img-src` violation and see "no network". Owner's call.                                                                                                                                                                                  | `docs/security/csp-baseline.md` (Follow-ups)                                                                            |
| **Instance caps or warm instances** on the booking and OTP callables | Platform defaults. Only `reportClientIssues` is capped (`maxInstances: 2`, plus a token bucket). **decide**                                                                                                                                                                              | `apps/functions/src/main.ts:1120-1127` (`reportClientIssues`)                                                           |
