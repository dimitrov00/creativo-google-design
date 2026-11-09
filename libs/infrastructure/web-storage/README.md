# web-storage

`@creativo/infrastructure/web-storage` — the browser's own storage and file
hand-off, for the web app only (`scope:shared`, `type:infrastructure`).

## Storage adapters

Each implements one `@core/ports` bundle over one browser store and is wired
in `apps/web/src/app/app.config.ts` under its token:

| Adapter                             | Bundle                | Store            | What it keeps                                                                                                      |
| ----------------------------------- | --------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------ |
| `sessionStorageBookingDraftPorts()` | `BookingDraftPorts`   | `sessionStorage` | the `/book` flow's draft, under a versioned key, cleared when the tab closes                                       |
| `localStorageAnalyticsCachePorts()` | `AnalyticsCachePorts` | `localStorage`   | the «Анализи» screen's last reports per account and request, without seat rows; cleared on sign-out and on refusal |

A failure of the store (`QuotaExceededError`, a disabled storage) is a
`RepositoryError` whose `reason` is the browser's own message
(`storageReason`), never a thrown exception.

## The file hand-off

`shareOrDownloadFile(name, blob)` is the app's one way to give a person a
file (staff analytics v2, «Export (PR 7)»):

- the device's share sheet when `navigator.share` exists and
  `navigator.canShare({ files })` admits the file — `SHARED`, or
  `CANCELLED` when the person closes the sheet (`AbortError`);
- an `<a download>` everywhere else, and after any other refusal of the
  sheet (a lost user activation, a type the platform will not share) —
  `DOWNLOADED`.

Call it from the click handler before any `await`, so the share sheet still
has the tap's user activation. It has no port and no token: a browser
download has no domain meaning. Its callers today: the «Анализи» CSV export,
the client card's «Изтегли данните» JSON and a visit's `.ics`.
