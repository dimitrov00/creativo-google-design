// The LAZY half of this lib: the Firestore SDK, the instance provider and
// every adapter over it. Nothing may import this module statically outside
// this lib — it is reached only through `loadFirestoreAdapters()`
// (./firestore.lazy.ts), which is what keeps firebase/firestore (and re2js,
// webchannel-wrapper) out of the web app's initial chunk.
// tools/verify/bundle/check-initial-bundle.mjs fails a build where it leaks.
export * from './firestore-db.provider';
export * from './firestore-paths';
// The flip-1 (booking core), flip-2 (identity and accounts), flip-3
// (loyalty) and flip-4 (programs) bundles: `(db) => bundle` factories, each
// bound in app.config.ts with `provideLazyPort`'s factory form. The
// rhythm's publish gateway is the one over the callable (`(functions, memo)`).
export * from './accounts.adapter';
export * from './appointment-notes.adapter';
export * from './appointments.adapter';
export * from './catalog.adapter';
export * from './client-stats.adapter';
export * from './coupons-vouchers.adapter';
export * from './customers.adapter';
export * from './impersonation.adapter';
export * from './loyalty.adapter';
export * from './loyalty-catalog.adapter';
export * from './notifications.adapter';
export * from './programs.adapter';
export * from './scheduling.adapter';
export * from './streak-definitions.adapter';
export * from './streak-publish-gateway.adapter';
export * from './waitlist.adapter';
// The one class adapter still bound with the class form: the dormant
// reward progress.
export * from './reward-progress-reader.adapter';
