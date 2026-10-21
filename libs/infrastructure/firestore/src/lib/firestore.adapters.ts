// The LAZY half of this lib: the Firestore SDK, the instance provider and
// every adapter over it. Nothing may import this module statically outside
// this lib — it is reached only through `loadFirestoreAdapters()`
// (./firestore.lazy.ts), which is what keeps firebase/firestore (and re2js,
// webchannel-wrapper) out of the web app's initial chunk.
// tools/verify/bundle/check-initial-bundle.mjs fails a build where it leaks.
export * from './firestore-db.provider';
export * from './firestore-paths';
// The flip-1 (booking core) and flip-2 (identity and accounts) bundles:
// `(db) => bundle` factories, each bound in app.config.ts with
// `provideLazyPort`'s factory form.
export * from './accounts.adapter';
export * from './appointment-notes.adapter';
export * from './appointments.adapter';
export * from './catalog.adapter';
export * from './client-stats.adapter';
export * from './coupons-vouchers.adapter';
export * from './customers.adapter';
export * from './impersonation.adapter';
export * from './notifications.adapter';
export * from './scheduling.adapter';
export * from './waitlist.adapter';
// The flip-3/4 class adapters, still bound with the class form.
export * from './loyalty-reader.adapter';
export * from './loyalty-catalog-reader.adapter';
export * from './loyalty-activity-reader.adapter';
export * from './streak-definition-repository.adapter';
export * from './invitation.adapter';
export * from './reward-progress-reader.adapter';
export * from './position-repository.adapter';
export * from './course-repository.adapter';
export * from './event-repository.adapter';
