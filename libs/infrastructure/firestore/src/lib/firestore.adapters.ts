// The LAZY half of this lib: the Firestore SDK, the instance provider and
// every adapter over it. Nothing may import this module statically outside
// this lib — it is reached only through `loadFirestoreAdapters()`
// (./firestore.lazy.ts), which is what keeps firebase/firestore (and re2js,
// webchannel-wrapper) out of the web app's initial chunk.
// tools/verify/bundle/check-initial-bundle.mjs fails a build where it leaks.
export * from './firestore-db.provider';
// The read-time guard the composition root binds for the appointment,
// customer and scheduling bundles (edge hardening D-7) — reached only
// through this lazy module, so `@core/systems` stays off the eager chunk.
export { guardedReads, type ReadGuard } from './observe';
// The flip-1 (booking core), flip-2 (identity and accounts), flip-3
// (loyalty) and flip-4 (programs) bundles: `(db) => bundle` factories, each
// bound in app.config.ts with `provideLazyPort`'s factory. The rhythm's
// publish ports are composed over the callable client
// (`(gateway, memo)`), and the loyalty catalogue's shop day over the clock
// and the default location — both built in this lazy scope, so the
// `@core/pipelines` and `@core/systems` they reach stay out of the initial
// chunk.
export * from './accounts.adapter';
export * from './appointment-notes.adapter';
export * from './appointments.adapter';
export * from './audit.adapter';
export * from './catalog.adapter';
export * from './client-stats.adapter';
export * from './coupons-vouchers.adapter';
export * from './customers.adapter';
export * from './loyalty.adapter';
export * from './loyalty-catalog.adapter';
export * from './notifications.adapter';
export * from './programs.adapter';
export * from './scheduling.adapter';
export * from './streak-definitions.adapter';
export * from './streak-publish.adapter';
export * from './waitlist.adapter';
// The loyalty catalogue's shop day is a pipeline (`shopToday`,
// `@core/pipelines`); this lazy module carries it as a NAMED re-export —
// never the namespace — so app.config.ts binds it inside the firebase-data
// scope and it, `readShopZone` and `ZonedTimeSystem` stay off the eager
// graph (phase-4a §9 R10, the phone field's `*.lazy.ts` precedent).
export { shopToday } from '@core/pipelines';
