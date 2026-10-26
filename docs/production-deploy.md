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
> `tools/verify/preflight/preflight.mjs:1039-1049`.

The preflight is a read-only check that the project is ready (OR-35, DEP-F26).
Both predeploy hooks in `firebase.json` run it too and refuse the deploy if a
check fails. Run it by hand before you start, in both scopes as above, so a
failure doesn't land in the middle of a deploy. By hand it defaults to
`--scope web` (P1–P6), so build the web first (`pnpm nx build web`) or P4
fails with "no built scripts"; only `--scope functions` (P1–P3, P6–P8) runs
P7 and P8. Without `--project` it falls back to `$GCLOUD_PROJECT`, then to
`.firebaserc`'s default. On a first deploy P2 and P3 fail until the index
deploy of section 3.1 has run; that is expected. P8 fails every functions
deploy until the OTP sender of section 1 lands — that is the point. Its eight
checks are:

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
failed, 2 = bad arguments. If P6 fails, P1–P3 are skipped; P7 and P8 read only
the repository, so they run either way.
Source: `tools/verify/preflight/preflight.mjs:1-56`, `:100-103`, `:463-920`,
`:1039-1062`; runbook §3 (`docs/architecture/firestore-runbook.md:193-209`).

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
      gen 2 (`runtime: nodejs22`), they bind a Secret Manager secret, and three
      `onSchedule` jobs need Cloud Scheduler. None of these deploy on the Spark
      plan. The first `firebase deploy --only functions` offers to enable the
      APIs it needs (Cloud Functions, Cloud Build, Artifact Registry, Cloud Run,
      Eventarc, Pub/Sub, Cloud Scheduler, Secret Manager). Accept them.
      Source: `firebase.json:9-25`; `apps/functions/src/main.ts:338`, `:722-732`,
      `:839-841`.
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
      Source: `apps/functions/src/main.ts:186-191`;
      `libs/infrastructure/firebase-app/src/lib/firebase-app.provider.ts:121`;
      `firebase.json:41`; `tools/verify/csp/check-csp.mjs:170-173`.
- [ ] **Create the (default) Firestore database (Native mode) and the Storage
      bucket** before the first rules or functions deploy. P1–P3 read Firestore.
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
(`tools/verify/preflight/preflight.mjs:23-24`, `:200-203`).

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
      `tools/verify/preflight/preflight.mjs:399-435`.
- [ ] **Point the CSP at the real callables host.** In `firebase.json`, change
      `https://us-central1-creativo-replace-me.cloudfunctions.net` to
      `https://us-central1-<PROJECT_ID>.cloudfunctions.net`. If the host is
      wrong, every callable (booking, OTP, staff) is blocked by `connect-src`.
      Edit `.firebaserc` first: `check-csp.mjs` compares `connect-src` with the
      host of `.firebaserc`'s default project (check (d)), and CI runs it on
      every push. Then check it:

```bash
pnpm nx build web
```

```bash
node tools/verify/csp/check-csp.mjs
```

Source: `firebase.json:41`; `tools/verify/csp/check-csp.mjs:20-22`,
`:170-173`, `:312`; `.github/workflows/ci.yml:42-43`;
`docs/security/csp-baseline.md` (Follow-ups, "The project id"); P5.

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
      `roles/serviceusage.serviceUsageConsumer`. `firebase login` alone is not
      enough. The step-1 index/TTL deploy also needs Owner or Cloud Datastore
      Index Admin.

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
`apps/functions/src/main.ts:330-351`;
`docs/architecture/decisions/2026-10-26-owner-rulings.md:710`.

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
`apps/functions/src/adapters/console-otp-sender.adapter.ts:6-53`;
`apps/functions/src/main.ts:284-299`, `:338-341`, `:444-474`;
`apps/functions/src/edge.ts` (`IDENTITY_WIRE`);
`tools/flags/write-functions-env.mjs:97-99`;
`tools/verify/preflight/preflight.mjs:831-879` (P7), `:881-920` (P8).

- [ ] **Keep the login-OTP sender separate from any campaign or marketing
      sender (owner rule).** It gets its own provider account or sub-account,
      its own API-key secret, its own sending identity (a dedicated `auth.*`
      from-address and its own SMS sender id or number) and its own adapter
      file. Never send marketing through `OtpDeliveryPorts`, and never reuse
      this identity from a campaign adapter. No campaign sender exists today.
      Source: `apps/functions/src/adapters/console-otp-sender.adapter.ts:7-11`;
      `apps/functions/src/main.ts:288-292`.
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
- [ ] **Backups — nothing in the repo sets them up. decide.** Suggested: turn
      on Point-in-Time Recovery and add a daily backup schedule. Storage objects
      (media, avatars, visit photos) need their own policy, such as soft delete
      or versioning. This matters most during the hand-written bootstrap
      (section 2), which has no undo.

```bash
gcloud firestore databases update --database='(default)' --enable-pitr --project="$PROJECT_ID"
```

```bash
gcloud firestore backups schedules create --database='(default)' --recurrence=daily --retention=28d --project="$PROJECT_ID"
```

Source: `firebase.json:2-8` (only rules and indexes configured).

- [ ] **Cloud Audit Logs (optional, decide).** Turn on DATA_WRITE (not
      DATA_READ) for the Cloud Firestore API, and route it to a separate
      long-retention bucket so the 30-day `_Default` promise below isn't
      affected. This comes from the design-research launch checklist, not
      from an owner ruling.
      Source: `docs/design-research/client-details-design.md:11430`, `:11451`.
- [ ] **Budget and alerts — decide the amount.** Google Cloud console →
      Billing → Budgets & alerts: a monthly budget with e-mail alerts. All
      callables are reachable without App Check (see section 8), and only
      `reportClientIssues` is capped (`maxInstances: 2`).
      Source: `apps/functions/src/main.ts:945-952`; Deferred #4.

### Monitoring and privacy (owner's, OR-34)

- [ ] **Create the `client_issue_count` logs metric** after the first
      functions deploy. Write the YAML from runbook §3 step 7 (filter
      `jsonPayload.clientIssueKind:*`, label `kind`, DELTA INT64) to
      `/tmp/client_issue_count.yaml`, then:

```bash
gcloud logging metrics create client_issue_count --project="$PROJECT_ID" --config-from-file=/tmp/client_issue_count.yaml
```

- [ ] **Add an alert policy** in Cloud Monitoring → Alerting on
      `logging.googleapis.com/user/client_issue_count` above 100 per 5 minutes,
      with an e-mail notification channel.
      Source: `docs/architecture/firestore-runbook.md:240-259`;
      `docs/architecture/decisions/2026-10-26-owner-rulings.md:915`.
- [ ] **Turn on Error Reporting notifications.** There is no Sentry or Pino
      (D11(a)): Cloud Logging plus Error Reporting is the only error channel
      for both server and client errors.
      Source: `apps/functions/src/adapters/console-telemetry.adapter.ts:5-22`;
      `docs/architecture/decisions/2026-10-26-owner-rulings.md:886`, `:1528`.
- [ ] **Publish the privacy-policy line:** "diagnostic data under legitimate
      interest, 30-day Cloud Logging retention, no personal identifiers". Keep
      the `_Default` log bucket at 30 days so the statement stays true.
      Source: `docs/architecture/decisions/2026-10-26-owner-rulings.md:919`;
      `docs/architecture/HANDOFF.md:2364-2374`.

### Schedules and flags

- [ ] **Check that `CRON_TIME_ZONE` matches the shop.** The three nightly jobs
      (`sweepCapacityDaily` 03:00, `sweepClientStatsPolicyDaily` 03:30,
      `sampleBarberLeadTimeDaily` 04:00, each with `retryCount: 3`) fire on
      `'Europe/Sofia'`, a deploy-time constant. If `loc-center.timeZone` is a
      different zone, edit the constant before deploying functions.
      Source: `apps/functions/src/lib/cron-zone.ts:11`;
      `apps/functions/src/main.ts:722-732`, `:839-841`.
- [ ] **Review the production feature-flag map.** All 13 flags in
      `config/feature-flags.json` → `production` are `false` today, so loyalty,
      the client profile, pause, support, merge, privacy, referrals and
      discount grants ship dark. The web bakes the map in at build time. The
      functions get it from `.env.<projectId>`, which the predeploy writes. A
      real project gets the `production` map unless `FLAGS_ENV` / `--env` says
      otherwise. To light a flag: deploy functions first, then web. To turn one
      off: web first.
      Source: `config/feature-flags.json:32-46`;
      `apps/web/src/environments/environment.production.ts:2`;
      `tools/flags/write-functions-env.mjs:7-24`, `:106-115`;
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
      Source: `firestore.rules:511-514`;
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
      Source: `firestore.rules:496-535`; `storage.rules:54-57`;
      `tools/seed/fixtures/catalog.fixtures.ts`, `schedules.fixtures.ts`.
- [ ] **`settings/bookingPolicy` (optional).** If it is absent,
      `BookingPolicy.withDefaults` applies. Writing it fires
      `rebuildCapacityOnSettingsChange`.
      Source: `apps/functions/src/adapters/firestore-settings.adapter.ts:26-36`;
      `firestore.rules:712-720`; `tools/seed/fixtures/settings.fixtures.ts`.
- [ ] **The first admin, then the staff.** No callable grants roles
      (`grantRoles` is unbuilt), and the rules never let a client write
      `users/{uid}`. Roles reach the ID token only from the stored
      `users/{uid}.roles`, and only at sign-in. Steps:
  1. The person signs in once through OTP and finishes registration. This
     needs the real OTP sender from section 1.
  2. With Admin credentials, set the root `roles` array on `users/{uid}` (for
     example `['admin']`, `['sysadmin']`, `['barber']`). Use only known `Roles`
     tags, never a nested or dotted field.
  3. The person signs out and back in, so `verifyOtpChallenge` (the
     `verifyOtp` pipeline) mints the new claims.

     The known tags are `client`, `barber`, `receptionist`, `content_manager`,
     `admin` and `sysadmin`; an unknown one is dropped from the token.
     Source: `firestore.rules:190-219`;
     `libs/ecs-core/src/pipelines/verify-otp.pipeline.ts:60-64`;
     `libs/ecs-core/src/components/role.data.ts:15-22`;
     `libs/ecs-core/src/components/auth-claims.data.ts:94-101`;
     `tools/seed/fixtures/users.fixtures.ts:30-40` (`registeredAccountBody`).

---

## 3. Every deploy, in order

Deploys are manual, from a clean `main` whose CI is green. CI
(`.github/workflows/ci.yml`) has no deploy job. It runs format, affected
lint/test/build, the static CSP hash check, the icon checks, `pnpm audit` and
gitleaks. It doesn't run the emulator CSP smoke.

This is runbook §3's ordinary order. Its Phase 4a exception (rules after
functions and hosting, `firestore-runbook.md:265-270`) protects a project
already serving a pre-4a web whose direct writes the tightened rules close;
a first deploy has no such web, so the ordinary order applies.

### 3.0 The gate

- [ ] Run the full gate from `docs/architecture/HANDOFF.md` §4 (sync:check,
      layering, typecheck, lint, test, `test ecs-core --coverage`,
      `typecheck seed-tools`, build web, verify:bundle, build functions +
      check-functions-deps, the grep gates, `verify:p0`, `test:emulator`,
      `e2e:web`). Run the emulator journeys one at a time.
      Source: `docs/architecture/HANDOFF.md:2102-2133`.
- [ ] Run the CSP gate on its own, because it starts every emulator. A changed
      inline script (the pre-paint script, or Beasties output after an Angular
      update) changes the hashes, and the enforced CSP would then block it.

```bash
pnpm run verify:csp
```

- [ ] Make sure no emulator variable (`FIRESTORE_EMULATOR_HOST`,
      `FUNCTIONS_EMULATOR`, …) is set in the deploying shell, then run the
      preflight in both scopes (only the functions scope runs P7 and P8):

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
`firestore.indexes.json` (24 `indexes`, 99 `fieldOverrides`, 7 with
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

### 3.3 Functions

```bash
firebase deploy --only functions --project "$PROJECT_ID"
```

The predeploy hook already runs, in order: `pnpm nx build functions`, then
`node tools/flags/write-functions-env.mjs` (the `production` flag map into
`dist/apps/functions/.env.<projectId>`), then the preflight with
`--scope functions` (P1–P3, P6–P8). Don't set `FLAGS_ENV` for production.
The deploy fails closed if `loc-center`, the TTLs or the composites aren't
ready, if an emulator-only adapter (the console OTP sender, the fixed OTP
code) is wired outside the emulator (P7), while the refusing OTP sender is
still wired (P8), or if `WALKIN_ID_KEY` is missing.

The deploy holds 47 functions. Audit-hardening WS-3 (DEP-14) added thirteen
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

### 3.4 Hosting, straight after functions

The hosting predeploy does **not** build. It only runs the preflight with
`--scope web` (P1–P6) over `dist/apps/web/browser`. Build first:

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

- [ ] Create the `client_issue_count` metric and its alert (section 1,
      Monitoring).

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
      `client_issue_count` metric exists. Error Reporting shows no new group.
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
- [ ] **A CSP or shell change that has to reach every client now:** returning
      clients run the cached shell and policy for one service-worker cycle.
      Force the update (`SwUpdate`) or ship the `safety-worker.js` kill switch.
- [ ] Indexes are never pruned before section 5, so older code keeps its
      composites. A rollback doesn't undo data writes; that needs PITR
      (section 1).

Source: `docs/architecture/firestore-runbook.md:207`, `:265-267`;
`firebase.json:26-34`; `tools/verify/preflight/preflight.mjs:53-56`,
`:1083-1086`;
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
      Source: `apps/functions/src/main.ts:257-258`, `:293-295`, `:450-451`;
      `tools/verify/preflight/preflight.mjs:117-118`, `:189-195`.
- [ ] **Never deploy the test `WALKIN_ID_KEY`.** `.secret.local` (a public
      TEST value) is written only for `demo-*` projects, and `firebase.json`'s
      `functions.ignore` keeps it and `.env.local` out of the upload. Keep
      those ignore entries. The functions predeploy rebuilds
      `dist/apps/functions` first, and the env writer's own comment says the
      build wipes that folder; even so, don't run a `demo-*` command
      (`pnpm run dev`, `e2e:web`, `verify:p0`, `verify:csp`) in the same tree
      between the build and a real deploy.
      Source: `firebase.json:11-24`; `tools/flags/write-functions-env.mjs:12-20`,
      `:97-99`, `:158-164`.
- [ ] **Keep `emulators.enabled: false`** in `environment.production.ts`. It
      also keeps the `window.__e2eSignIn` test hook unwired.
      Source: `apps/web/src/environments/environment.production.ts:16-23`;
      `apps/web/src/app/app.ts:22-30`.
- [ ] **Never rotate `WALKIN_ID_KEY`** (section 1), and **never answer Yes to
      deletions on the step-1 index deploy** (section 3.1).
- [ ] **Never deploy production with `FLAGS_ENV=staging`** (or
      `--env staging`): the predeploy would write the staging map into the
      production project's `.env.<projectId>`.
      Source: `tools/flags/write-functions-env.mjs:7-24`, `:106-115`.

---

## 8. Deferred security items to revisit

| Item                                                                 | State at launch                                                                                                                                                                                                          | Ruling                                                                                                        |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| **App Check** on the callables and `reportClientIssues`              | Not wired: the web has no provider and no callable enforces it. **Leave enforcement OFF in the console**, or every callable from the current build is refused. Needs reCAPTCHA hosts in the CSP and an enrolment design. | Deferred #4 (`docs/architecture/decisions/2026-10-26-owner-rulings.md:1472`); `docs/security/csp-baseline.md` |
| **Trusted Types, enforced**                                          | Report-Only (`require-trusted-types-for 'script'`). Waits until the MapLibre sinks and the SW-registration report are gone.                                                                                              | Deferred #3 (`…owner-rulings.md:1471`); `firebase.json:43-46`                                                 |
| **HSTS `preload`**                                                   | Not set (close to irreversible). Add it once the apex domain is final.                                                                                                                                                   | Deferred #10 (`…owner-rulings.md:1478`); OR-29                                                                |
| **Firestore connectivity probe** (`www.google.com` in `img-src`)     | Blocked: clients on a failing network report an `img-src` violation and see "no network". Owner's call.                                                                                                                  | `docs/security/csp-baseline.md` (Follow-ups)                                                                  |
| **Instance caps or warm instances** on the booking and OTP callables | Platform defaults. Only `reportClientIssues` is capped (`maxInstances: 2`, plus a token bucket). **decide**                                                                                                              | `apps/functions/src/main.ts:945-952`                                                                          |
