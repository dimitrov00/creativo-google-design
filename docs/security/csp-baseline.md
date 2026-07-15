# CSP baseline

`apps/marketing` is the first app in this workspace with a real per-request
server (`apps/marketing/src/server.ts`) and ships the target policy below for
real, verified end-to-end against the built SSR server (see "Verified"
below). `apps/client`/`apps/staff` are CSR SPAs with no server of their own —
their real headers depend on whatever static-hosting layer serves them
(Firebase Hosting), see "Not yet done."

## Target policy

```
Content-Security-Policy:
  default-src 'self';
  script-src 'self' 'nonce-<per-request-nonce>';
  style-src 'self' 'nonce-<per-request-nonce>' https://fonts.googleapis.com;
  font-src 'self' https://fonts.gstatic.com;
  img-src 'self' data:;
  connect-src 'self';
  object-src 'none';
  base-uri 'self';
  frame-ancestors 'none';

Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(), microphone=(), geolocation=()
```

Notes:

- `style-src`/`font-src` allow Google Fonts (`fonts.googleapis.com` /
  `fonts.gstatic.com`) because every app's `index.html` loads Roboto and
  Roboto Flex from there (see `docs/design-research/design-google-notes.md`'s
  exact-match-theme update — not Google Sans Flex/Source Serif 4, an earlier
  pre-pixel-match guess). Self-hosting the font files would let us drop this
  allowance — worth revisiting once real traffic makes that origin
  dependency worth removing.
- No `'unsafe-inline'` anywhere. Angular's `ngCspNonce` mechanism (see below) is
  what makes that possible for the styles Angular injects at runtime.
- `frame-ancestors 'none'` — none of these apps should ever be framed. Revisit
  per-app if an embed use case shows up.

## Per-app `connect-src`/`img-src` extensions

The base policy above is shared; each authenticated app extends `connect-src`
for the Firebase services it actually calls. **`apps/marketing` gets no
Firebase additions at all** — it has zero direct Firebase SDK usage by
product decision (a future contact/waitlist form would go through a single
named Cloud Function endpoint, not broad Firebase domains — add that single
URL when the form exists, not before).

- **`apps/client`, `apps/staff`** — both use `@creativo/adapters/firebase`
  (Auth, Firestore, Functions), so both need:
  ```
  connect-src 'self'
    https://firestore.googleapis.com
    https://identitytoolkit.googleapis.com
    https://securetoken.googleapis.com
    https://*.cloudfunctions.net;
  ```
  (Narrow `*.cloudfunctions.net` to the real deployed region+project once
  known, e.g. `https://us-central1-<project>.cloudfunctions.net` — left broad
  here only because no real project ID exists yet.)
- `img-src` gains the Firebase Storage host (`https://firebasestorage.googleapis.com`)
  on `client`/`staff` once real asset URLs exist — not needed yet, `storage.rules`
  is still a placeholder deny-all this pass.
- **Stripe (follow-up, not live yet)** — when the deposit flow ships, `apps/client`
  will need `script-src` to allow `https://js.stripe.com`, `connect-src` to allow
  `https://api.stripe.com`, and `frame-src`/`child-src` allowances for Stripe
  Elements' iframes. Documented here now so whoever picks up that pass doesn't
  have to rediscover it; nothing in this pass makes a Stripe network call.

## Angular's nonce mechanism

Angular can stamp a nonce onto the `<style>` tags it inserts at runtime (for
component styles), which is what lets `style-src` avoid `'unsafe-inline'`. The
mechanism: add an `ngCspNonce` attribute to the root element in `index.html`.

Every app's `index.html` carries this placeholder:

```html
<cr-root ngcspnonce="__CSP_NONCE__"></cr-root>
```

`apps/showcase`/`apps/client`/`apps/staff` are static CSR builds — for them
`__CSP_NONCE__` stays a literal placeholder until a real edge/CDN layer with
per-request logic is chosen (Firebase Hosting alone serves static files
as-is; substituting a real nonce would need a Cloud Function/Cloud Run layer
in front, which none of these three apps have — they're plain SPAs).

**`apps/marketing` is the one app that actually does this for real**, because
it has a genuine per-request Node/Express server. `apps/marketing/src/server.ts`:

1. Generates a fresh `crypto.randomBytes(16)` nonce per request.
2. Replaces `__CSP_NONCE__` in the rendered HTML with that value.
3. Sets the real `Content-Security-Policy` response header (and the other
   four headers from the target policy above) with the same nonce.

**Verified**: built `apps/marketing`, ran the produced
`dist/apps/marketing/server/server.mjs` directly, and confirmed via `curl`
that the response's `ngcspnonce="..."` attribute value and the
`Content-Security-Policy: script-src 'self' 'nonce-...'` header value are
identical on every request, and that all five headers (CSP, HSTS,
X-Content-Type-Options, Referrer-Policy, Permissions-Policy) are present.

**Deployment gotcha found during that verification, not previously
documented anywhere**: `@angular/ssr`'s Node request handler validates the
incoming `Host` header against an allow-list and returns `400 Bad Request`
for anything not on it — a real SSRF hardening feature
([angular.dev/best-practices/security#preventing-server-side-request-forgery-ssrf](https://angular.dev/best-practices/security#preventing-server-side-request-forgery-ssrf)),
not a bug. Configure it via the `NG_ALLOWED_HOSTS` environment variable
(comma-separated **hostnames without port**, e.g. `NG_ALLOWED_HOSTS=creativo.com`)
wherever `server.mjs` actually runs in production — Cloud Run's service
config or the deploy script, not committed anywhere as a file since the real
value depends on the final domain choice.

## Hosting/deploy notes (from wiring `firebase.json` this pass)

- `apps/client`/`apps/staff` are plain static SPA hosting targets in
  `firebase.json` — unambiguous, fully wired, no open questions.
- `apps/marketing`'s Hosting rewrite in `firebase.json` points at a Cloud Run
  service (`"run": {"serviceId": "marketing-ssr", ...}`), **not** Firebase's
  web-frameworks auto-detection — this repo has no `angular.json` anywhere
  (confirmed), which that auto-detection has historically keyed off, so
  auto-detection may not even recognize `apps/marketing` as Angular. Cloud
  Run also avoids forcing marketing's SSR server into `apps/functions`
  (tagged `scope:backend` for OTP/domain logic — a different concern from
  marketing's own SSR deploy artifact).
- **Not yet built this pass**: the actual Cloud Run deployment (Dockerfile,
  build/push/deploy steps) for `marketing-ssr` — `serviceId`/`region` in
  `firebase.json` are placeholders. This is real follow-up infrastructure
  work, not a config-file-only task, and needs a real GCP project to build
  and test against.

## Not yet done

- No headers are actually served in production anywhere yet (no real Firebase
  project/hosting sites exist — `.firebaserc` is a checked-in template with a
  placeholder project ID).
- The Cloud Run deployment backing `apps/marketing`'s Hosting rewrite doesn't
  exist yet (see above).
- `connect-src`/`img-src` will grow further once Stripe and Cloud Storage
  asset URLs are real (see the per-app section above) — this is a snapshot,
  not a final list.
