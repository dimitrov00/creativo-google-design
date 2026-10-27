# CSP baseline

> **Status (2026-10-26, pass F).** Rewritten from scratch by the owner
> rulings OR-29 – OR-32 and OR-34
> (`docs/architecture/decisions/2026-10-26-owner-rulings.md`). The Phase-0
> record this file used to be — per-request SSR nonces, Google Fonts, three
> apps — described a setting that no longer exists (DEP-F23): `apps/web` is
> one CSR app on Firebase Hosting, its faces are self-hosted, and no server
> sits in front of it. `firebase.json` is the policy's ONE home; this file
> says why each line is there and how it is kept true.

## What Hosting serves

Every response of the web site carries, from the `**` header rule of
`firebase.json`'s `web` hosting entry:

| Header                                | Value                                                                                  |
| ------------------------------------- | -------------------------------------------------------------------------------------- |
| `Content-Security-Policy`             | the policy below                                                                       |
| `Content-Security-Policy-Report-Only` | `require-trusted-types-for 'script'; trusted-types angular angular#bundler`            |
| `Strict-Transport-Security`           | `max-age=31536000; includeSubDomains`                                                  |
| `X-Content-Type-Options`              | `nosniff`                                                                              |
| `Referrer-Policy`                     | `strict-origin-when-cross-origin`                                                      |
| `Permissions-Policy`                  | `camera=(self), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()` |
| `Cross-Origin-Opener-Policy`          | `same-origin`                                                                          |
| `X-Frame-Options`                     | `DENY`                                                                                 |

### The policy, directive by directive

```
default-src 'self';
script-src 'self' 'sha256-<pre-paint theme>' 'sha256-<Beasties media swap>';
style-src 'self' 'unsafe-inline';
img-src 'self' data: blob: https://firebasestorage.googleapis.com;
font-src 'self';
media-src 'self';
connect-src 'self' https://firestore.googleapis.com https://identitytoolkit.googleapis.com
  https://securetoken.googleapis.com https://firebasestorage.googleapis.com
  https://us-central1-<PROJECT_ID>.cloudfunctions.net https://tiles.openfreemap.org;
worker-src 'self' blob:;
manifest-src 'self';
frame-src 'none';
object-src 'none';
base-uri 'self';
form-action 'self';
frame-ancestors 'none';
upgrade-insecure-requests
```

- **`default-src 'self'`** — anything a directive below does not name is
  same-origin only.
- **`script-src`** — the app's own chunks, plus EXACTLY the two static
  inline scripts the built `index.html` carries: the pre-paint
  theme/density/language script (`apps/web/src/index.html`, blueprint §7.6)
  and the Beasties media swap the builder's critical-CSS pass writes
  (`link[data-beasties-media]` → `media`). No nonce (there is no server to
  mint one), no `'unsafe-inline'`, no `'unsafe-eval'` — the build has no
  `eval`, `innerHTML` or `bypassSecurityTrust*` sink (measured at
  `1322b782`). A hash is a script the policy admits by name, so an extra
  one is refused as firmly as a missing one (`check-csp.mjs`, below).
- **`style-src 'self' 'unsafe-inline'`** — Angular writes every component's
  styles into `<style>` tags at runtime, and `ui-map` puts MapLibre's
  stylesheet into one (`maplibre-loader.ts`); without per-request nonces
  neither can be hashed. A style injection cannot run script, which is
  what this policy is for (OR-29 options B and C were declined).
- **`img-src`** — the app's own images, `data:` (inline SVG and
  placeholders), `blob:` (a camera capture before upload, MapLibre's
  decoded sprites) and Storage's download host (avatars, catalogue
  renditions, visit photos).
- **`font-src 'self'`** — `@fontsource` faces, self-hosted under `media/`.
- **`media-src 'self'`** — the landing's `hero.mp4` and `welcome.mp4`. The
  camera's live preview is a `MediaStream` (`srcObject`), which no
  directive governs.
- **`connect-src`** — Firestore, Auth (`identitytoolkit`, `securetoken`),
  Storage, the callables of the DEFAULT region of the `.firebaserc`
  default project (an exact host, never `*.cloudfunctions.net`), and
  OpenFreeMap's styles, tiles, sprites and glyphs (MapLibre fetches them
  all; none is an `<img>`). `<PROJECT_ID>` is the literal of `.firebaserc`'s
  default — the placeholder `creativo-replace-me` until the project exists;
  the production preflight refuses a mismatch or the placeholder (OR-35 P5,
  P6).
- **`worker-src 'self' blob:`** — the Angular service worker, and MapLibre's
  tile worker (without it the map silently never draws). Since maplibre-gl
  6 that worker is the self-hosted module `/maplibre-gl-worker.mjs`, which
  `'self'` admits (`MAPLIBRE_WORKER_PATH`, `maplibre-loader.ts`); v5 started
  it from a `blob:` URL. The map no longer needs `blob:` here: dropping it is
  a policy change, left to the owner.
- **`manifest-src 'self'`** — `manifest.webmanifest`.
- **`frame-src 'none'`** — the app embeds nothing. This holds because Auth
  is built with `initializeAuth` and no popup/redirect resolver (OR-32):
  `getAuth` would load `apis.google.com` and a hidden `__/auth/iframe` on
  phones and Safari, for sign-in flows the app never runs (every session
  starts from a custom token).
- **`object-src 'none'`, `base-uri 'self'`, `form-action 'self'`** — no
  plugins, no `<base>` hijack, no form posting off-site.
- **`frame-ancestors 'none'`** (and `X-Frame-Options: DENY` for older
  browsers) — nobody frames the app.
- **`upgrade-insecure-requests`** — a stray `http:` URL is fetched over
  HTTPS. Chromium leaves `127.0.0.1` alone (measured), so the emulator smoke
  below runs under the same directive.

### The other headers

- **Trusted Types, report-only.** `require-trusted-types-for 'script'`
  with Angular's own policy names. Nothing is enforced yet; every report
  but MapLibre's three measured sinks reaches the in-app sink (below), and
  the smoke pins today's list. The
  measured list (2026-10-26, the built app behind these headers in
  Chromium) is MapLibre's three sinks — its tile worker
  (`Worker constructor|blob:…`) and its attribution control
  (`DOMParser parseFromString`, `Element innerHTML`) — plus, in production
  only, Angular's service-worker registration
  (`ServiceWorkerContainer register|ngsw-worker.js`: it hands `register` a
  string; the smoke's build ships no service worker, so the smoke cannot
  see it). Enforcing waits on exactly those (Deferred #3: a DS attribution
  footnote, a worker policy, and a trusted URL for the registration).
- **HSTS** — a year, subdomains included. No `preload` until the apex
  domain is fixed: the preload list is near-irreversible (Deferred #10).
- **`Referrer-Policy: strict-origin-when-cross-origin`** — another origin
  learns the site, never the path (`/staff/schedule?day=…&barber=…`).
- **`Permissions-Policy`** — the camera for the visit photos and the code
  scanner, on this origin only; the microphone, geolocation, payments, USB
  and the Topics API for nobody.
- **`Cross-Origin-Opener-Policy: same-origin`** — no window this app opens
  or is opened by keeps a handle on it. Safe because no popup sign-in
  exists (OR-32).

## Caching

The cache rules follow the security rule, each header key set by ONE rule
per path (Hosting applies every matching rule in order; a later value
wins):

| Paths                                                                                                                                                                              | `Cache-Control`                       |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| `/`, every extensionless route (`**/!(*.*)`), `index.html`, `ngsw.json`, `ngsw-worker.js`, `safety-worker.js`, `worker-basic.min.js`, `manifest.webmanifest`, `assets/i18n/*.json` | `no-cache`                            |
| the hashed build files `/@(main\|polyfills\|chunk\|styles)-*.@(js\|css)`                                                                                                           | `public, max-age=31536000, immutable` |
| unhashed media (`ico`, `png`, `jpg`, `jpeg`, `webp`, `avif`, `gif`, `svg`, `mp4`, `webm`, `woff`, `woff2`, `ttf`, `otf`)                                                           | `max-age=86400`                       |

- The app shell and the service worker's update channel revalidate on
  every load, so a deploy reaches every client on its next start.
- A hashed file never changes under its name, so a year and `immutable`.
  The rule names the builder's four prefixes rather than `**/*.js`, which
  would also catch the unhashed service-worker scripts and freeze the
  update channel.
- **The i18n catalogues revalidate too** — a departure from the ruling's
  list: they are fetched unhashed (`assets/i18n/{lang}.json`) and change
  with every copy edit, and Hosting's default hour of caching would pair
  new chunks with yesterday's words (raw keys on screen).

## How the hashes stay true (`check-csp.mjs`)

The hashes are **computed by the gate, never typed by hand**.
`tools/verify/csp/check-csp.mjs` reads the BUILT `index.html` and
`firebase.json`, and fails on:

- a missing security header on the `**` rule;
- a `script-src` without `'self'`, or with `'unsafe-eval'`,
  `'unsafe-inline'`, `'unsafe-hashes'`, a nonce, a wildcard or a bare
  scheme;
- any difference between the sha256 of each inline script, recomputed,
  and the hashes `script-src` lists — on a mismatch it prints the exact
  `script-src` the artifact needs;
- an inline event handler or `javascript:` URL in the markup (a hash
  policy blocks both);
- a `connect-src` that does not name exactly the callables host of
  `.firebaserc`'s default project;
- a built js/css file, `/` or a route outside the cache rule its name
  calls for.

**When an inline script changes** (the pre-paint script in
`apps/web/src/index.html`, or the builder's critical-CSS output after an
Angular update): build (`pnpm nx build web`), run
`node tools/verify/csp/check-csp.mjs`, paste the `script-src` line it prints
into `firebase.json`, run it again. CI runs the gate after every build
(`.github/workflows/ci.yml`).

## The emulator smoke (`pnpm run verify:csp`)

The static gate proves the policy matches the artifact; the smoke proves
the app RUNS under it. `pnpm run verify:csp`:

1. builds production and gates it; builds `web:build:csp-smoke` —
   production minus the environment replacement (its SDKs talk to the
   emulators) and minus the service worker, into `dist/apps/web-csp-smoke`
   — and gates that too;
2. writes `dist/firebase.csp-smoke.json` (`tools/verify/csp/emulator-config.mjs`):
   `firebase.json` with the Auth, Firestore, Functions and Storage emulator
   origins (`http://127.0.0.1:<port>`) added to `connect-src` (and
   Storage's to `img-src`), and it **asserts the difference** — every other
   header, directive, source, rule source and order is production's. The
   rest is plumbing the CLI needs, no header sees it: `public` names the
   smoke build, the site is named by `site` (no `.firebaserc` target), and
   paths are re-pointed for a config file under `dist/`;
3. starts every emulator with Hosting on that config and runs
   `apps/web/e2e/csp/csp-smoke.spec.ts` (`pnpm nx run web:e2e-csp`,
   `apps/web/playwright.csp.config.mts`) on a desktop and a Pixel 7: the
   landing and its map, `/book` through the location map to the services,
   `/careers`, `/courses`, `/events`, `/account` as a client, the staff day
   with a visit sheet and its Storage photo as a barber, and
   `/admin/programs` as an admin. It fails on ANY violation of either
   disposition beyond the MapLibre report-only list above (tolerated only
   from the MapLibre chunk), on any site response missing a security
   header, and it pins `Cache-Control` on `/`, `/staff`, a hashed chunk and
   `ngsw.json`.

The full gate (HANDOFF §4) runs `verify:csp` from wave 1 of pass F on; it
shares the emulators' ports with `e2e:web`, so it runs alone.

## The service-worker header lag

Hosting attaches the headers to each RESPONSE. A returning client's
service worker serves `index.html` — and the policy that came with it —
from its own cache, so a changed policy reaches that client one update
cycle late: the first start after a deploy runs the cached shell under its
cached policy while `ngsw.json` (never cached) reveals the new version, and
the next start runs the new shell under the new policy. The two always
travel together, so a hash never meets a shell it was not computed for. A
policy change that must reach every client at once (a revoked origin) also
needs the service worker's update to be forced (`SwUpdate`), or the
`safety-worker.js` kill switch.

## Where violations go

`apps/web/src/main.ts` registers a `securitypolicyviolation` listener
before the app boots (OR-30). It drops reports a browser extension raised
(`chrome-extension:`, `moz-extension:`, `safari-web-extension:`) and the
measured MapLibre baseline — a report-only `require-trusted-types-for`
violation whose sample is one of the three of `MAPLIBRE_REPORT_ONLY_SINKS`
(`@creativo/infrastructure/firebase-app/csp-baseline`, the one list the
smoke tolerates them by): every map render trips them, and reported they
would spend the callable's shared throttle and the `client_issue_count`
alert on known noise at every landing and `/book` visit. An enforced
violation, and any other report-only one, is always reported. It hands
the rest — the directive, the disposition, the blocked ORIGIN (never a
path), the script and line that tripped it, the route's pattern — to the
first-party client issue sink (OR-34): the page's reporter, which dedupes,
caps a page session at 20 issues and batches them to the
`reportClientIssues` callable, which writes them to Cloud Logging
(`client_issue_count` by kind). There is no `report-uri` / `report-to`
endpoint: a public, unauthenticated report URL is exactly what OR-30
option B declined.

## Bundle record (OR-32, `verify:bundle`, 2026-10-26)

`@firebase/auth` in the initial chunk: 104.51 kB with `getAuth` →
92.67 kB with `initializeAuth` (−11.84 kB; the `__/auth/iframe` loader is
gone). The client issue sink added in the same package costs 13.0 kB of
the initial chunk (`ClientIssueSystem` 6.9, the error handler 4.1, the
reporter 1.1, the issue data and error 0.9). Initial total: 580.09 kB
(budget: warning 975 kB, error 1 MB).

## Follow-ups

- **Enforce Trusted Types** once the MapLibre sinks and the
  service-worker registration are gone (Deferred #3). Until then every
  production page session reports the registration once (one
  `reportClientIssues` call per session, deduped and batched).
- **Firestore's connectivity probe.** When a WebChannel request fails,
  Firestore's transport loads `https://www.google.com/images/cleardot.gif`
  to tell a dead network from a dead backend; `img-src` refuses it
  (measured with the backend unreachable), so a client on a failing
  network reports an enforced `img-src` violation and the probe reads as
  "no network". Admitting `https://www.google.com` in `img-src` is the
  owner's call (a request to Google on every failure); until then the
  reports name it.
- **App Check** on the callables needs a reCAPTCHA host admitted here
  (`script-src`, `frame-src`, `connect-src`) and an enrolment design
  (Deferred #4).
- **HSTS `preload`** once the apex domain is fixed (Deferred #10).
- **The project id**: `.firebaserc`'s placeholder becomes the real
  project, and `connect-src`'s callables host with it (`check-csp.mjs`
  keeps the two in step; the preflight refuses the placeholder).
- **Payments** (when they ship): the provider's script, API and frame
  hosts join `script-src`, `connect-src` and `frame-src` — each named
  exactly, never a wildcard.
