// The LAZY half of this lib: the Firestore SDK, the instance provider and
// every adapter over it. Nothing may import this module statically outside
// this lib — it is reached only through `loadFirestoreAdapters()`
// (./firestore.lazy.ts), which is what keeps firebase/firestore (and re2js,
// webchannel-wrapper) out of the web app's initial chunk.
// tools/verify/bundle/check-initial-bundle.mjs fails a build where it leaks.
export * from './firestore-db.provider';
export * from './firestore-paths';
export * from './appointment-repository.adapter';
export * from './appointment-notes.adapter';
export * from './availability-reader.adapter';
export * from './booking-policy-reader.adapter';
export * from './client-stats-reader.adapter';
export * from './client-stats-directory.adapter';
export * from './client-history-reader.adapter';
export * from './loyalty-reader.adapter';
export * from './loyalty-catalog-reader.adapter';
export * from './loyalty-activity-reader.adapter';
export * from './streak-definition-repository.adapter';
export * from './notification-reader.adapter';
export * from './schedule-exception-writer.adapter';
export * from './waitlist-reader.adapter';
export * from './catalog-reader.adapter';
export * from './coupon-grant-repository.adapter';
export * from './coupon-reader.adapter';
export * from './gift-voucher-reader.adapter';
export * from './client-vouchers-reader.adapter';
export * from './impersonation.adapter';
export * from './invitation.adapter';
export * from './profile.adapter';
export * from './reward-progress-reader.adapter';
export * from './user-search.adapter';
export * from './position-repository.adapter';
export * from './course-repository.adapter';
export * from './event-repository.adapter';
