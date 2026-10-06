// EAGER exports only — this barrel is in the web app's initial chunk, so
// nothing here may import firebase/firestore as a value (a type import is
// fine). The Firestore SDK, `provideFirestoreDb` and every Firestore adapter
// are one lazy chunk behind `loadFirestoreAdapters()` (./lib/firestore.lazy.ts);
// bind their ports with `provideLazyPort` (@creativo/infrastructure/firebase-app).
export * from './lib/firestore.lazy';
export * from './lib/subscribe-with-retry';
// The callable adapters only need firebase/functions, which the session
// loads at boot anyway.
export * from './lib/booking-gateway.adapter';
export * from './lib/waitlist-gateway.adapter';
export * from './lib/contact-change.adapter';
